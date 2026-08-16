/** DEMO FIXTURES — the deviceinfo `GET /state` document (slots 2/3/4). */

import type { DeviceInfoState } from '../deviceInfo'
import { scene } from './demoMode'
import { demoFleetDoc } from './fixtures.fleetDoc'
import { s } from './fixtures.sessions'

export function demoDeviceInfo(nowMs: number): DeviceInfoState {
  const fallback = scene('fallback')
  return {
    fleet: {
      router: {
        available: true,
        loaded: 'qwen3-coder-30b',
        loading: scene('loading') ? 'mistral-small-24b' : null,
        count: 4,
        ids: ['qwen3-coder-30b', 'llama-3.1-8b', 'mistral-small-24b', 'qwen3-vl-8b'],
      },
      coder: { reachable: true },
    },
    queue: {
      pending: 3,
      inProgress: 1,
      done: 27,
      review: 2,
      escalated: 0,
      failed: 1,
      obligations: { line: '2 open · 0 aged', error: null, cachedAt: nowMs - s(45) },
    },
    system: {
      disk: {
        root: { freeKb: 148_000_000, totalKb: 480_000_000, usedPct: 62 },
        // Past the 75% amber band, so both gauge tones are on screen at once.
        mntC: { freeKb: 190_000_000, totalKb: 1_000_000_000, usedPct: 81 },
      },
    },
    device: {
      tempC: 42,
      uptime: { raw: 'up 3 days, 4:12', load1: 0.42, load5: 0.55, load15: 0.61 },
      memory: { totalMb: 488, usedMb: 214, freeMb: 274 },
      disk: { size: '1.4G', used: '620M', avail: '780M', usePct: '45%' },
      backlight: 78,
    },
    mb: {
      switching: scene('switching')
        ? { id: 'demo.profile.prod', target: 'prod', phase: 'health', elapsedMs: s(38), startedAtMs: nowMs - s(38), budgetMs: s(95) }
        : null,
      lastResult: scene('banner')
        ? { id: 'demo.profile.swarm', ok: false, ms: 12_400, error: 'health gate never went green' }
        : null,
      pcreate: { up: true, port: 8188, probedAtMs: nowMs - s(4) },
    },
    // `?scene=fallback` drops the aggregator and shows the degraded
    // seat-occupancy-only panel instead -- a real, reachable state.
    fleet_state: fallback ? null : demoFleetDoc(nowMs),
    fleet_state_error: fallback ? 'aggregator unreachable' : null,
    fleet_fallback: fallback
      ? {
          probedAtMs: nowMs - s(2),
          configured: true,
          seats: [
            { id: 'worker', port: 8081, up: true, occupant: 'qwen3-coder-30b' },
            { id: 'senior', port: 8080, up: false, occupant: null },
          ],
        }
      : null,
    ts: nowMs,
  }
}
