/** DEMO FIXTURES — the primary fleet host (`fleet-state/1` shape). */

import type { FleetHost } from '../deviceInfo'
import { scene } from './demoMode'

const epoch = (nowMs: number, agoS: number) => Math.floor(nowMs / 1000) - agoS

/** The device's primary surface: one occupied seat, one EMPTY seat (that's
 *  the one offering SUMMON), several flip targets with `chat` active, and a
 *  thermals block whose fan fields are null by design. */
export function primaryDemoHost(nowMs: number): FleetHost {
  const loading = scene('loading')
  return {
    id: 'workstation',
    label: 'WORKSTATION',
    addr: '192.0.2.11',
    // primaryHost() falls back to role==='primary' when no host carries the
    // contract's stable primary-host id -- exactly this document's case.
    role: 'primary',
    reachable: true,
    checked_at_epoch: epoch(nowMs, 2),
    age_s: 2,
    error: null,
    leaf: { name: 'chat', known_leaves: ['chat', 'prod', 'swarm', 'pair', 'dsv4f', 'q38h'], transition: null },
    seats: [
      {
        id: 'worker',
        label: 'WORKER',
        port: 8081,
        state: loading ? 'loading' : 'serving',
        http_ok: true,
        ready: loading ? null : true,
        ready_gate: 'generation',
        // CHANNELING branch: a slot is generating right now, out of 4 total --
        // exercises the "CHANNELING n/slots" form (busy===true, slots>1).
        busy: loading ? null : true,
        busy_slots: loading ? null : 1,
        slots: loading ? null : 4,
        occupant: { id: 'qwen3-coder-30b', short: 'qwen3-coder-30b', capabilities: ['tools'] },
        checked_at_epoch: epoch(nowMs, 2),
        age_s: 2,
      },
      {
        id: 'senior',
        label: 'SENIOR',
        port: 8080,
        state: 'empty',
        http_ok: true,
        ready: null,
        ready_gate: 'none',
        // Genuinely idle -- must render byte-identical to null (no channeling).
        busy: false,
        busy_slots: 0,
        slots: 1,
        occupant: null,
        herald: false,
        checked_at_epoch: epoch(nowMs, 3),
        age_s: 3,
      },
    ],
    aux: [
      { id: 'tts', label: 'TTS', port: 8300, kind: 'speech', state: 'serving', occupant: { id: 'tts-small' }, age_s: 4 },
      { id: 'asr', label: 'ASR', port: 8301, kind: 'speech', state: 'unreachable', occupant: null, age_s: 6 },
    ],
    thermals: {
      available: true,
      checked_at_epoch: epoch(nowMs, 3),
      age_s: 3,
      cpu_tctl_c: 58,
      gpu_edge_c: 47,
      gpu_ppt_w: 74,
      gpu_sclk_mhz: 2100,
      gpu_busy_pct: 38,
      nvme_c: 41,
      load1: 1.9,
      // null on purpose -- exercises the "no tachometer, BIOS owns the fan
      // curve" path rather than drawing a dead gauge.
      fan_rpm: null,
      pwm_pct: null,
      fan_control: 'bios',
      status: 'ok',
    },
    commands: {
      // LEAVES renders from this roster, never a hardcoded list. `q38h` is
      // off the daily list, so it lands in READY-FOR-DUTY and picks up the
      // uncensored tone; `dsv4f` renders as GALACTUS.
      flip: ['chat', 'prod', 'swarm', 'pair', 'dsv4f', 'q38h'],
      summon: ['herald'],
      dismiss: true,
      confirm_required: true,
      est_seconds: { flip: 95, flip_warm: 40, summon_herald_cold: 150, summon_herald_warm: 55 },
    },
  }
}
