/**
 * DEMO FIXTURES — sessions. Entirely fictional.
 *
 * 🔴 Nothing here may name a real host, session, address or person. Session
 * names are invented services; the only real names anywhere in the demo data
 * are public open-model families, which are public facts.
 *
 * `nowMs` is passed in so "3s ago" labels stay alive instead of freezing.
 */

import type { Snapshot } from '../protocol'

export const s = (n: number) => n * 1000

/** Four sessions = SessionGrid's composed (non-scrolling) layout, and one of
 *  each interesting state: busy, attention-with-permission, high context
 *  pressure, and idle. */
export function demoSnapshot(nowMs: number): Snapshot {
  return {
    sessions: [
      {
        id: 'demo-api-gateway',
        name: 'api-gateway',
        state: 'busy',
        lastActivityTs: nowMs - s(3),
        tokens: { in: 48_200, out: 12_400 },
        context: 0.42,
        pendingPermission: false,
        permissionMode: 'default',
        ended: false,
      },
      {
        id: 'demo-payments-svc',
        name: 'payments-svc',
        state: 'attention',
        lastActivityTs: nowMs - s(11),
        tokens: { in: 91_500, out: 27_800 },
        context: 0.78,
        pendingPermission: true,
        permissionMode: 'default',
        ended: false,
      },
      {
        // The red-band context tile.
        id: 'demo-web-client',
        name: 'web-client',
        state: 'busy',
        lastActivityTs: nowMs - s(1),
        tokens: { in: 184_000, out: 63_100 },
        context: 0.93,
        pendingPermission: false,
        permissionMode: 'plan',
        ended: false,
      },
      {
        id: 'demo-docs-site',
        name: 'docs-site',
        state: 'idle',
        lastActivityTs: nowMs - s(640),
        tokens: { in: 9_300, out: 2_100 },
        context: 0.11,
        pendingPermission: false,
        permissionMode: 'default',
        ended: false,
      },
    ],
    stats: { active: 3, attention: 1 },
    // The device has no RTC and no NTP -- the real daemon supplies this and
    // every countdown renders against it, so the fixture must too.
    serverNowMs: nowMs,
    tzOffsetMin: 0,
  }
}
