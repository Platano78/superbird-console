/** DEMO FIXTURES — the permission queue and the plan-limit rails. */

import type { Ask, Usage } from '../protocol'
import { scene } from './demoMode'
import { s } from './fixtures.sessions'

function demoPermission(nowMs: number): Ask {
  return {
    kind: 'permission',
    id: 'demo-ask-1',
    sessionId: 'demo-payments-svc',
    sessionName: 'payments-svc',
    createdTs: nowMs - s(9),
    tool: 'Bash',
    summary: 'npm run migrate -- --env staging',
    // ~595_000 is the daemon's real permission timeout -- the countdown on
    // the card is rendered from it.
    timeoutMs: 595_000,
  }
}

/** The pending permission card is the product's most important screen, and
 *  it steals the whole display — so it is OPT-IN via `?scene=ask`, otherwise
 *  no other page could ever be photographed. */
export function demoAsks(nowMs: number): Ask[] {
  return scene('ask') ? [demoPermission(nowMs)] : []
}

/** The real daemon keeps the last ask per session after it leaves the queue;
 *  SESSION DETAIL renders it. Populated here so tapping the payments-svc
 *  tile shows a full detail view even with an empty live queue. */
export function demoLastAskBySession(nowMs: number): Record<string, Ask> {
  return { 'demo-payments-svc': demoPermission(nowMs) }
}

export function demoUsage(): Usage {
  return {
    updatedLabel: 'updated 1m ago',
    subscription: 'demo plan',
    limits: [
      { key: 'session', label: 'SESSION', used: 0.46, detail: 'resets in 2h 40m' },
      { key: 'week-all-models-', label: 'WEEK · ALL MODELS', used: 0.71, detail: 'resets Thu 9:00am' },
      // Past 0.9 -> red tape AND the TopBar "limit" lamp lights.
      { key: 'week-fable-', label: 'WEEK · FABLE', used: 0.92, detail: 'resets Thu 9:00am' },
    ],
  }
}
