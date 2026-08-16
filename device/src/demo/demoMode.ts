/**
 * DEMO MODE — activation, scene selection, and the "action went nowhere"
 * notice channel.
 *
 * Design law (owner ruling): demo swaps the DATA SOURCE, never the
 * components. Everything here decides *whether* demo data is in play; the
 * fixtures themselves live in ./fixtures.ts and are shaped exactly like the
 * real sources (deviceinfo `/state`, the daemon's snapshot/queue/usage).
 * Page components stay ignorant of demo except for the badge in TopBar.
 *
 * Activation, in priority order:
 *   1. `?demo=0` / `?demo=off`   -> hard OFF, beats everything (escape hatch).
 *   2. `?demo=1` / `?demo=on` or the SUPERBIRD_DEMO build flag -> forced ON.
 *   3. AUTO: the daemon is unreachable AND fleet state is positively
 *      unconfigured -> a fresh clone with nothing set up.
 *   4. otherwise OFF (real data).
 *
 * 🔴 Rule 3's discriminator matters: "configured but currently down" must
 * NEVER become demo -- faking liveness during a real outage is the exact
 * dishonesty the rest of this codebase (per-probe staleness, honest
 * unreachable tiles) exists to avoid. Two guards enforce it:
 *   - positive evidence of unconfigured-ness (the service answering with
 *     fleet_state=null AND fleet_fallback.configured===false, which is the
 *     service's own "unset = disabled, never probe" report), and
 *   - a sticky local marker: once this browser has EVER seen a live daemon
 *     or a live deviceinfo service, auto-demo is disabled for good on this
 *     device, so a configured kiosk that boots faster than its backend can
 *     never flash fixture data.
 * A totally silent host (nothing answering at all) is treated as a fresh
 * clone -- that is the case demo mode exists for.
 */

import { useEffect, useState } from 'react'
import type { DeviceInfoState } from '../deviceInfo'

function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  // The kiosk loads the app from file://, where a query string survives but
  // is easy to lose when a URL is retyped -- accept the hash form too, so
  // `index.html#demo=1&scene=ask` works identically.
  const q = window.location.search.replace(/^\?/, '')
  const h = window.location.hash.replace(/^#/, '')
  return new URLSearchParams(q && h ? `${q}&${h}` : q || h)
}

const PARAMS = readParams()
const DEMO_PARAM = (PARAMS.get('demo') || '').toLowerCase()
const FORCED_OFF = DEMO_PARAM === '0' || DEMO_PARAM === 'off'
const BUILD_DEMO = typeof __SUPERBIRD_DEMO__ !== 'undefined' && __SUPERBIRD_DEMO__

/** Forced ON at load time: no network of any kind may be opened (App.tsx
 *  skips the WebSocket, deviceInfo.ts skips the poll). */
export const DEMO_FORCED = !FORCED_OFF && (DEMO_PARAM === '1' || DEMO_PARAM === 'on' || DEMO_PARAM === 'true' || BUILD_DEMO)

/** `?scene=a,b` — screenshot control. Unknown names are ignored. */
const SCENES = new Set(
  (PARAMS.get('scene') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
)
export function scene(name: string): boolean {
  return SCENES.has(name)
}

// Module-level mirror of the hook's answer. Needed because the two action
// chokepoints (fleet/shared.ts fireAction, ControlSlot.tsx postAction) are
// plain functions, not components -- they cannot read React state, and they
// are exactly where a demo tap must stop.
let active = DEMO_FORCED
export function isDemoActive(): boolean {
  return active
}

const SAW_BACKEND_KEY = 'superbird.sawBackend'
// file:// localStorage is unavailable in some Chromium configurations --
// degrade to the reachability rule rather than throwing.
function readSawBackend(): boolean {
  try {
    return window.localStorage.getItem(SAW_BACKEND_KEY) === '1'
  } catch {
    return false
  }
}
function markSawBackend() {
  try {
    window.localStorage.setItem(SAW_BACKEND_KEY, '1')
  } catch {
    /* storage disabled -- the in-session state below still holds */
  }
}

/** How long a real backend gets to show up before auto-demo may engage. */
const AUTO_GRACE_MS = 5000

/**
 * The single decision point. Called once, from App.tsx, with the two
 * liveness signals the app already has.
 */
export function useDemoMode(daemonConnected: boolean, serviceReachable: boolean, info: DeviceInfoState | null): boolean {
  const [graceElapsed, setGraceElapsed] = useState(false)
  const [everSawBackend, setEverSawBackend] = useState(readSawBackend)

  // deps [] -- one timer for the app lifetime, never keyed on poll state.
  useEffect(() => {
    const t = window.setTimeout(() => setGraceElapsed(true), AUTO_GRACE_MS)
    return () => window.clearTimeout(t)
  }, [])

  const backendSeen = daemonConnected || serviceReachable
  // Keyed on a BOOLEAN (not on the poll-produced objects themselves) and
  // self-disarming via everSawBackend -- runs at most once, so it cannot
  // become the React #185 update loop this device has hit before.
  useEffect(() => {
    if (!backendSeen || everSawBackend) return
    markSawBackend()
    setEverSawBackend(true)
  }, [backendSeen, everSawBackend])

  // Positive evidence only: either nothing at all answered (fresh clone), or
  // the service itself reports the fleet as unconfigured.
  const fleetUnconfigured =
    !serviceReachable || (!!info && info.fleet_state == null && info.fleet_fallback?.configured === false)

  const auto = !FORCED_OFF && !everSawBackend && graceElapsed && !daemonConnected && fleetUnconfigured
  const on = DEMO_FORCED || auto
  active = on
  return on
}
