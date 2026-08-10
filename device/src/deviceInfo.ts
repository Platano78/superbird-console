import { useEffect, useRef, useState } from 'react'

// `ids` is the router's live model roster -- ControlSlot renders its tiles
// from this, never from a hardcoded list (the roster changes).
export type RouterInfo = { available: boolean; loaded: string | null; count: number | null; ids: string[]; error?: string }
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
export type DeviceInfoState = {
  fleet: { router: RouterInfo; coder: CoderInfo }
  queue: QueueCounts
  system: { disk: DiskInfo }
  device: DeviceBlock
  ts: number
}

const DEVICEINFO_URL = 'http://127.0.0.1:8791/state'
const POLL_MS = 5000
const FETCH_TIMEOUT_MS = 2000

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
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return { data, reachable }
}
