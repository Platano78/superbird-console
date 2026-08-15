import { useEffect, useRef, useState } from 'react'

// `ids` is the router's live model roster -- ControlSlot renders its tiles
// from this, never from a hardcoded list (the roster changes).
// `loading` is the model id currently mid-load (router status.value ===
// "loading"), or null when nothing is. Never inferred from a client-side
// timer -- it ends only when /state reports the id has moved to `loaded`.
export type RouterInfo = {
  available: boolean
  loaded: string | null
  loading: string | null
  count: number | null
  ids: string[]
  error?: string
}
export type CoderInfo = { reachable: boolean; error?: string }
export type DiskReading = { freeKb: number; totalKb: number; usedPct: number } | null
export type DiskInfo = { root: DiskReading; mntC: DiskReading; error?: string }
export type ObligationsInfo = { line: string | null; error: string | null; cachedAt: number }
export type QueueCounts = {
  pending: number | null
  inProgress: number | null
  done: number | null
  review: number | null
  escalated: number | null
  failed: number | null
  obligations: ObligationsInfo
}
export type DeviceUptime = { raw: string | null; load1: number | null; load5: number | null; load15: number | null }
export type DeviceMemory = { totalMb: number; usedMb: number; freeMb: number } | null
export type DeviceDisk = { size: string; used: string; avail: string; usePct: string } | null
export type DeviceBlock =
  | { tempC: number | null; uptime: DeviceUptime; memory: DeviceMemory; disk: DeviceDisk; backlight: number | null; error?: undefined }
  | { error: string }
export type MbSwitching = {
  id: string
  target: string
  phase: 'launch' | 'health' | 'completion' | 'down'
  elapsedMs: number
  startedAtMs: number
  budgetMs: number
} | null
export type MbLastResult = { id: string; ok: boolean; ms: number; error?: string } | null

// `fleet-state/1` -- THE SCHEMA OF RECORD, owned by fleet-aggregator:
// fleet-aggregator/docs/fleet-state-contract.md. car-thing is a CONSUMER only; nothing
// here re-derives fleet state by probing /v1/models (contract "one producer,
// many consumers"). Types below mirror the contract's document shape.
//
// 🔴 Law 7 (additive evolution): consumers must ignore unknown keys and must
// not crash on an enum value they don't recognise. `state` fields below are
// typed as the known literals for editor help, but every switch on them in
// this codebase carries a `default` arm that degrades gracefully (renders
// "--" / unknown-safe), never a `never`-exhaustiveness assert.

export type FleetSeatState = 'serving' | 'loading' | 'empty' | 'unreachable' | 'unknown'

export type FleetOccupant = {
  /** The truth -- never parsed. */
  id: string
  /** Best-effort prettification, may be wrong, missing, or (today) a raw
   *  33+ char GGUF basename that doesn't fit a ~12-char tile. Never parsed --
   *  see the fleet-state contract §2.1: we asked fleet-aggregator for a
   *  short_display field; until it lands the device truncates this. */
  short?: string
  capabilities?: string[]
}

export type FleetSeat = {
  id: string
  label: string
  port: number
  state: FleetSeatState
  /** /v1/models answered -- NOT readiness (law 4). Never render this as "ready". */
  http_ok: boolean
  /** true only once a real completion came back; null = not gate-tested --
   *  a null tile must make NO readiness claim at all. */
  ready: boolean | null
  ready_gate?: 'generation' | 'http' | 'none'
  occupant: FleetOccupant | null
  /** true only when a 122B-class herald holds this seat (senior only). */
  herald?: boolean
  checked_at_epoch?: number
  /** Per-probe staleness -- trust this over the document's own generated_at
   *  (law 5). Grey the individual tile, never the page. */
  age_s: number
}

export type FleetAux = {
  id: string
  label: string
  port: number
  kind: string
  state: FleetSeatState
  occupant?: FleetOccupant | null
  unit?: string
  unit_active?: string
  checked_at_epoch?: number
  age_s?: number
}

export type FleetLeaf = {
  /** May be "unknown" -- must render, not crash (law 2). */
  name: string
  inferred_from?: string
  known_leaves?: string[]
  transition: { target: string; started_epoch?: number; phase?: string } | null
}

export type FleetThermalStatus = 'ok' | 'warm' | 'hot' | 'critical'
export type FleetThermals = {
  available: boolean
  checked_at_epoch?: number
  age_s?: number
  cpu_tctl_c: number | null
  gpu_edge_c: number | null
  gpu_ppt_w: number | null
  gpu_sclk_mhz?: number | null
  gpu_busy_pct: number | null
  nvme_c: number | null
  load1: number | null
  /** null BY DESIGN on fleet-host -- no tachometer exists. Never render as
   *  a dead gauge or "N/A"; switch on `fan_control` instead. */
  fan_rpm: number | null
  /** null BY DESIGN on fleet-host -- no OS-controllable PWM. */
  pwm_pct: number | null
  fan_control: 'bios' | 'os' | 'unknown'
  status: FleetThermalStatus
} | null

export type FleetCommands = {
  /** Never a hardcoded roster -- LEAVES renders from this list. Empty on
   *  lifeline/bench hosts -> monitoring-only, no flip control offered. */
  flip: string[]
  summon: string[]
  dismiss: boolean
  confirm_required?: boolean
  est_seconds?: Record<string, number>
}

export type FleetHost = {
  id: string
  label: string
  addr?: string
  role?: 'primary' | 'lifeline' | 'bench' | string
  reachable: boolean
  checked_at_epoch?: number
  age_s?: number
  error?: string | null
  leaf?: FleetLeaf
  seats: FleetSeat[]
  aux: FleetAux[]
  thermals: FleetThermals
  commands: FleetCommands
}

export type FleetWarning = { host: string; level: string; code: string; text: string }

export type FleetStateDoc = {
  schema: string
  generated_at?: string
  generated_at_epoch?: number
  poll_interval_s?: number
  producer?: string
  hosts: FleetHost[]
  warnings?: FleetWarning[]
}

// mb -- controller-owned state ONLY (the fleet-state contract §4).
// Everything that used to live here (reachable/profile/workerModel/
// seniorModel/sideModel/herald/seats/leaves/aux/the old server-clock
// staleness anchor) is now the contract's job -- see FleetStateDoc above,
// with ONE deliberate exception: `pcreate`. fleet-state/1 does not model
// pcreate at all -- it holds no seat and is not a leaf (contract §3 /
// the fleet-state contract §3) -- so probing it here duplicates no
// producer-side truth and re-derives no leaf-inference logic; it's simply a
// service the schema doesn't cover. See services/deviceinfo/mb.js.
export type MbPcreate = { up: boolean; port: number; probedAtMs: number }
export type MbState = {
  switching: MbSwitching
  lastResult: MbLastResult
  pcreate: MbPcreate
}

/** Seat-occupancy-only fallback, sourced by services/deviceinfo/mb.js
 *  ONLY when `fleet_state` is null (the fleet-aggregator aggregator is unreachable) --
 *  a SIBLING of `fleet_state`, never merged into it. `occupant` is the raw
 *  `/v1/models` `models[0].name` string, verbatim -- no leaf/profile
 *  inference (that stays fleet-aggregator's job alone, per fleet-state-contract.md). */
export type FleetFallbackSeat = { id: string; port: number; up: boolean; occupant: string | null }
export type FleetFallback = { probedAtMs: number; seats: FleetFallbackSeat[] } | null
export type DeviceInfoState = {
  fleet: { router: RouterInfo; coder: CoderInfo }
  queue: QueueCounts
  system: { disk: DiskInfo }
  device: DeviceBlock
  mb: MbState
  /** fleet-state/1, re-exported VERBATIM by services/deviceinfo/mb.js under
   *  this key. null (with `fleet_state_error` set) when the aggregator is
   *  unreachable -- distinct from a reachable-but-empty document. */
  fleet_state: FleetStateDoc | null
  fleet_state_error?: string | null
  /** null whenever fleet_state is present (happy path, zero probes issued);
   *  non-null only while the aggregator is down. See FleetFallback above. */
  fleet_fallback: FleetFallback
  ts: number
}

const DEVICEINFO_URL = 'http://127.0.0.1:8791/state'
const POLL_MS = 5000
// Accelerated cadence for a short window after CONTROL fires an action --
// closes the real-state gap (router-control.sh switch doesn't report
// "loading" until it finishes unloading the previous model, measured +8s on
// hardware) without hammering the service the rest of the time.
const FAST_POLL_MS = 1000
const FAST_POLL_WINDOW_MS = 15000
// Module-level, not React state -- deliberately: this is read by the single
// poll loop below on each tick, not something a component re-renders on.
// ONE interval mechanism total (see the self-rescheduling setTimeout in
// useDeviceInfo) -- this flag changes its cadence, it never spawns a second
// timer that could drift out of sync with the first.
let fastUntil = 0
export function requestFastPoll() {
  fastUntil = Date.now() + FAST_POLL_WINDOW_MS
}
// ⚠ MUST stay comfortably ABOVE the service's own per-source timeout (2000ms in
// services/deviceinfo/server.js) and BELOW POLL_MS.
//
// This was 2000 — exactly equal to the server's — and it made the whole
// degraded-state design unreachable. When any source is down, /state takes the
// full 2.00s to answer (measured: 2.001s, 2.002s, 2.000s), so the client aborted
// at the same instant the server replied and lost the race EVERY time. The UI
// then showed "deviceinfo service unreachable" instead of the real state — i.e.
// the one situation the honest per-source error reporting exists for was the one
// situation it could never be seen in. Router down rendered as service down, and
// the ROUTER start tile that fixes it was never drawn.
const FETCH_TIMEOUT_MS = 4500

/**
 * Polls the read-only deviceinfo service (services/deviceinfo/server.js,
 * reached over `adb reverse`). One interval for the component lifetime,
 * deps [] -- the same React #185 guard App.tsx's daemon polling already
 * uses: never key this effect on the state it produces.
 *
 * A failed/timed-out poll sets `reachable: false` and leaves the last-good
 * `data` untouched only for one missed tick's worth of staleness signalling
 * -- callers must check `reachable`, never assume `data` is fresh.
 */
export function useDeviceInfo() {
  const [data, setData] = useState<DeviceInfoState | null>(null)
  const [reachable, setReachable] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false
    let nextTimer: number | null = null
    async function poll() {
      if (inFlight.current) return
      inFlight.current = true
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
      try {
        const res = await fetch(DEVICEINFO_URL, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`http ${res.status}`)
        const body = (await res.json()) as DeviceInfoState
        if (!cancelled) {
          setData(body)
          setReachable(true)
        }
      } catch {
        if (!cancelled) setReachable(false)
      } finally {
        clearTimeout(timer)
        inFlight.current = false
      }
    }
    // Self-rescheduling setTimeout, not setInterval -- the ONLY timer this
    // hook owns. Each next tick is scheduled after the previous poll
    // resolves, so a slow request can never stack overlapping polls, and
    // cadence can vary (fast window vs steady) without ever needing a
    // second, independently-drifting timer.
    async function tick() {
      await poll()
      if (cancelled) return
      const delay = Date.now() < fastUntil ? FAST_POLL_MS : POLL_MS
      nextTimer = window.setTimeout(tick, delay)
    }
    void tick()
    return () => {
      cancelled = true
      if (nextTimer !== null) window.clearTimeout(nextTimer)
    }
  }, [])

  return { data, reachable }
}
