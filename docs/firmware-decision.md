# Firmware decision — DeskThing

**Date:** 2026-07-31
**Status:** RATIFIED (user call) · **AMENDED 2026-08-02 — see below**
**Decides:** which Car Thing firmware we build the Claude Code monitor against.

---

## ⚠ AMENDMENT 2026-08-02 — DeskThing dropped as a RUNTIME dependency

Faulkner **D-f18d6e0d** (amends D-7c50e23a). The firmware verdict below **still stands**:
`8.9.2-thinglabs` is the right image, and it is what gives us root ADB and a Chromium kiosk.
**No reflash is needed — the thinglabs image already IS the blank slate.**

What changed is the **application layer**. The device now runs a standalone web app served
from its own disk, connecting **directly** to the daemon at `ws://127.0.0.1:8790/ws` via
`adb reverse`. **DeskThing no longer has to be running.**

**Mechanism** (verified on device 2026-08-02):
- rootfs is `ro`, but `mount -o remount,rw /` succeeds; `/usr/share/` is then writable
- `/etc/supervisord.conf:51` holds the kiosk line —
  `--kiosk --app=file:///usr/share/qt-superbird-app/webapp/index.html`
- our app goes to `/usr/share/claude-thing/`; line 51 is repointed there
- **the stock Spotify webapp is left intact**, so reverting is a one-line edit
- 172 MB free vs a ~250 KB bundle

**Why.** The DeskThing app layer cost a full session in failures unrelated to the product:
an undocumented mandatory `request` field (or payload extraction resolves to `never`); a
fractional `version_code` crashing the app process with *"Undefined value received"*; an icon
that must be named `icons/<app-id>.svg` or every load throws ENOENT; and — worst — a crashed
server half that silently swallowed every client tap **while the daemon still reported a
healthy connection**, because a stale process from an earlier version held the socket.
Dropping the layer removes that whole failure class, plus the iframe/postMessage hop and the
server-half relay.

Crucially this rests on measurement, not expectation: the direct transport was **proven on
2026-08-01 before the decision was taken** — device-side `wget`/`curl`/`nc` fetched `/status`,
a hand-rolled WebSocket handshake to `/ws` returned `HTTP/1.1 101` with a valid
`Sec-WebSocket-Accept`, and the daemon pushed a live `claude.sessions.update` frame to the device.

**Residual host dependency:** `adb reverse tcp:8790 tcp:8790` (scriptable at login). Binding the
daemon beyond `127.0.0.1` would remove even that, but exposes a surface that can *answer
permission prompts* to the whole LAN — deferred until the daemon has auth.

### ⚠ Device constraint: ES modules do NOT load from `file://`

The kiosk loads the app over `file://`, and browsers refuse `<script type="module">` there:

```
Failed to load module script: The server responded with a non-JavaScript MIME type of ""
```

A default Vite build (ESM only) therefore renders a **completely blank screen** with no
console error visible unless you catch the load. The build must emit a **classic-script**
(`nomodule`) bundle — `@vitejs/plugin-legacy` with `renderLegacyChunks: true`.

This is not a guess: the stock Spotify webapp ships exactly this legacy pair
(`index-legacy-*.js` + `polyfills-legacy-*.js`) for the same reason, and the same MIME error
appears in the DeskThing client's own console on this device.

The DeskThing-SDK app that first proved the protocol end-to-end is superseded by `device/`
and is not included here -- this repository ships only the app that actually runs.

---

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

- ~~**The `adb reverse` hypothesis.**~~ ✅ **RESOLVED 2026-08-01 — it works.** Proven from the
  device: `wget`/`curl`/`nc` all fetched `/status`, and a WebSocket handshake to `/ws` returned
  `HTTP/1.1 101` with the daemon pushing a live `claude.sessions.update` frame. This retired the
  Bluetooth PAN and `nocturne-connector` fallbacks, and it is what made the 2026-08-02 amendment
  above possible.
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
