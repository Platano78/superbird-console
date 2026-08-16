/** DEMO FIXTURES — secondary hosts + the assembled fleet-state document. */

import type { FleetHost, FleetStateDoc } from '../deviceInfo'
import { primaryDemoHost } from './fixtures.fleet'

const epoch = (nowMs: number, agoS: number) => Math.floor(nowMs / 1000) - agoS

/** Monitoring-only chips under the seats grid: one healthy bench host with
 *  no control verbs, and one host that is genuinely DOWN -- honest states are
 *  part of what the screenshots have to teach. */
function secondaryDemoHosts(nowMs: number): FleetHost[] {
  return [
    {
      id: 'gpu-node',
      label: 'GPU-NODE',
      addr: '192.0.2.21',
      role: 'bench',
      reachable: true,
      checked_at_epoch: epoch(nowMs, 4),
      age_s: 4,
      error: null,
      leaf: { name: 'unknown', transition: null },
      seats: [
        {
          id: 'worker',
          label: 'WORKER',
          port: 8081,
          state: 'serving',
          http_ok: true,
          ready: true,
          occupant: { id: 'llama-3.1-8b', short: 'llama-3.1-8b' },
          age_s: 4,
        },
      ],
      aux: [],
      thermals: null,
      commands: { flip: [], summon: [], dismiss: false },
    },
    {
      id: 'edge-box',
      label: 'EDGE-BOX',
      addr: '192.0.2.31',
      role: 'lifeline',
      reachable: false,
      checked_at_epoch: epoch(nowMs, 21),
      age_s: 21,
      error: 'connect ETIMEDOUT 192.0.2.31:8084',
      seats: [
        { id: 'worker', label: 'WORKER', port: 8084, state: 'unreachable', http_ok: false, ready: null, occupant: null, age_s: 21 },
      ],
      aux: [],
      thermals: null,
      commands: { flip: [], summon: [], dismiss: false },
    },
  ]
}

export function demoFleetDoc(nowMs: number): FleetStateDoc {
  return {
    schema: 'fleet-state/1',
    generated_at: new Date(nowMs).toISOString(),
    generated_at_epoch: Math.floor(nowMs / 1000),
    poll_interval_s: 5,
    producer: 'demo-fixture',
    hosts: [primaryDemoHost(nowMs), ...secondaryDemoHosts(nowMs)],
    warnings: [{ host: 'edge-box', level: 'warn', code: 'host_unreachable', text: 'no answer in 21s' }],
  }
}
