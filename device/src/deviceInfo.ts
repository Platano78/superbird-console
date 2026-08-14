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
export type MbSwitching = { id: string; target: string; phase: string; elapsedMs: number } | null
export type MbLastResult = { id: string; ok: boolean; ms: number; error?: string } | null
export type MbState = {
  reachable: boolean
  profile: 'chat' | 'prod' | 'swarm' | 'pair' | 'dsv4f' | null
  workerModel: string | null
  seniorModel: string | null
  sideModel: string | null
  herald: boolean
  pcreate: boolean
  switching: MbSwitching
  lastResult: MbLastResult
  error?: string
}
export type DeviceInfoState = {
  fleet: { router: RouterInfo; coder: CoderInfo }
  queue: QueueCounts
  system: { disk: DiskInfo }
  device: DeviceBlock
  mb: MbState
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
