# Firmware decision — DeskThing

**Date:** 2026-07-31
**Status:** RATIFIED (user call)
**Decides:** which Car Thing firmware we build the Claude Code monitor against.

## Verdict

**DeskThing** (thinglabs image from thingify.tools).

Reflashing is cheap and recoverable, so this is not a one-way door — but it determines the
app model, the host transport, and whether any Mac dependency exists.

## The candidates

| | `claude-thing` (Nocturne fork) | **DeskThing** | Mira |
|---|---|---|---|
| Server OS | **Mac only** — LaunchAgent, `.dmg`, Xcode to build | **Windows 10/11, macOS, Linux** (v0.11.17) | none (standalone) |
| Device transport | Swift **Bluetooth** relay inside `Nocturne.app` | **ADB** (Auto Detect ADB / Use Global ADB) | BT or USB tether, for internet only |
| App model | fork the firmware, target Chrome 69 | **SDK**: `@deskthing/server` + `@deskthing/client`, Node backend + React frontend, WebSocket between them | **none — no extension point** |
| Distribution | rebuild + reflash | server handles install / deps / updates | n/a |
| Claude integration | exists, but Mac-shaped | we write it | impossible |

## Why DeskThing

1. **It removes the Mac dependency structurally, not by workaround.** The only reason
   `claude-thing` needs a Swift app is to bridge Bluetooth to `ws://127.0.0.1:8790`.
   DeskThing already has a cross-platform ADB device link, so that bridge is not code
   we have to write.
2. **Real SDK.** React frontend + Node backend with a documented WebSocket channel beats
   maintaining a firmware fork.
3. **Windows is a first-class target**, which matters — this box is Windows 11 + WSL2.

## Why not the others

- **`claude-thing` direct fork** — we'd get their exact UI, but would have to write a
  Windows replacement for the Swift Bluetooth relay *before anything renders at all*.
  Highest-risk, most novel code, for a UI we can rebuild.
- **Mira** — standalone by design: "no companion app, no extra account, no subscription."
  Our entire use case is a host-side daemon reading Claude Code session state. Mira has
  nowhere to put it. Correct choice if the device should just play music again.

## What we keep from `claude-thing`

The firmware fork is disposable. The valuable part is **firmware-agnostic**:

- `daemon/` — plain Node 18+, listens `ws://127.0.0.1:8790/ws`. Session discovery,
  permission queue, window focus, usage aggregation.
- `protocol/claude-protocol.md` — the `claude.*` message contract. See
  [claude-protocol.md](claude-protocol.md) for the extracted spec.

Plan: keep both, drop the firmware fork and the Swift relay, reimplement the device UI
as a DeskThing app.

## Open risks (unverified)

- **The `adb reverse` hypothesis.** Assumption is `adb reverse tcp:8790 tcp:8790` lets a
  DeskThing app reach the daemon. Strongly suggested by DeskThing's ADB-based link, but
  NOT yet tested. This is the first probe — if it fails, the transport story reopens.
- **Multiple-choice questions may not port.** `claude-thing`'s README admits they require
  terminal focus + manual key typing (Mac Accessibility APIs). No Windows equivalent ships.
  Permission allow/deny (the 55s path) looks daemon-direct and should be fine; the
  `claude.question.answer` path likely needs writing from scratch.
- **`./mac/install.sh` rewrites `~/.claude/settings.json`** (with backup). Do NOT run it.
  Extract the hook definitions and port them by hand — this box has a hand-tuned hook config.

## Sources

- https://github.com/rithkott/claude-thing
- https://deskthing.app/ · https://github.com/ItsRiprod/DeskThing
- https://www.npmjs.com/package/@deskthing/server · https://www.npmjs.com/package/@deskthing/client
- https://github.com/mira-thing/mira-releases/releases/tag/v1.0.0
- https://github.com/usenocturne/nocturne
