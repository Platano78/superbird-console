/** The demo stand-in for the daemon's live State — same shape, no socket. */

import type { State } from '../daemon'
import { demoAsks, demoLastAskBySession, demoUsage } from './fixtures.asks'
import { demoSnapshot } from './fixtures.sessions'

export function demoDaemonState(nowMs: number): State {
  return {
    // The DEMO badge, not a dead "offline" lamp, is what tells the viewer
    // this isn't live -- a demo that advertises a broken connection teaches
    // the wrong thing about the device.
    connected: true,
    snapshot: demoSnapshot(nowMs),
    asks: demoAsks(nowMs),
    usage: demoUsage(),
    // Fixture timestamps are already device-clock-relative.
    offsetMs: 0,
    lastAskBySession: demoLastAskBySession(nowMs),
  }
}
