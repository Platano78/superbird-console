# Operations runbook — how the Car Thing surface runs

Standing architecture after **D-f18d6e0d** (DeskThing dropped as a runtime dependency).

```
Car Thing (Chromium kiosk, file:///usr/share/claude-thing/index.html)
   └─ ws://127.0.0.1:8790/ws  ──[ adb reverse ]──►  claude-thing daemon (WSL, systemd)
                                                      ├─ poller: `claude agents --json`
                                                      └─ hooks:  http → 127.0.0.1:8790/hook
```

Nothing else needs to be running. **DeskThing is not involved.**

## The two services (systemd --user)

| Unit | Does |
|---|---|
| `claude-thing.service` | the daemon, from `~/claude-thing/daemon` |
| `car-thing-adb.service` | re-asserts `adb reverse` every 30 s (`scripts/keep-adb-reverse.sh`) |

```bash
systemctl --user status claude-thing.service car-thing-adb.service
systemctl --user restart claude-thing.service
journalctl --user -u claude-thing.service -n 50 --no-pager
curl -s http://127.0.0.1:8790/status        # the one-line health check
```

Healthy `/status` looks like:
`{"sessions":5,...,"clients":{"car-thing":1},"sources":["poller","hooks"],"hooks":true}`

- `clients.car-thing` — the device is connected. Missing → `adb reverse` is down.
- `sources` — `poller` needs `claude` on PATH; `hooks` needs settings.json entries.
- `hooks:true` — the settings.json hooks are registered.

⚠ **systemd user services do NOT inherit the shell PATH.** Without the explicit
`Environment=PATH=` line the poller dies with `spawn claude ENOENT` and silently degrades to
hooks-only — `sources` still lists `poller`, so trust `sessions` and the journal, not that field.

## Hooks — installed BY HAND

**Never run `claude-thing`'s `scripts/install-hooks.js`.** It rewrites `~/.claude/settings.json`
wholesale and this box has a hand-tuned config. The by-hand installer that appends only, refuses
to write if any existing entry would be lost, and backs up first:
`scratchpad/install-hooks-by-hand.mjs` (reproduced below).

Seven `type:"http"` entries pointing at `http://127.0.0.1:8790/hook`:
`PermissionRequest` (timeout 40), `SessionStart` 5, `SessionEnd` 3, `UserPromptSubmit` 5,
`PreToolUse` 5, `PostToolUse` 5, `Stop` 5. Applied 2026-08-02; existing entries went
8→9, 2→3, 6→7, 7→8, and backups are at `~/.claude/settings.json.pre-claude-thing-*`.

⚠ **The hook timeout must stay ABOVE the daemon's hold** or Claude Code gives up first and the
device answers into a closed connection. Hold is `CLAUDE_THING_HOLD_MS=30000` (30 s) on the
service; hook timeout is 40 s.

⚠ **Hold time is a UX decision, not a constant.** Upstream ships 595 s. At that value a prompt
sits on a *silent terminal* for ~10 minutes if nobody is watching the device. 30 s means: answer
on the Car Thing, or it falls through to the normal terminal prompt.

⚠ Hooks apply to **sessions started after** they were installed.

## Deploying a UI change

```bash
cd ~/project/car-thing/device && npm run build
# stage to a Windows-reachable path, then push + restart the kiosk
```
Device side (`/etc/supervisord.conf:51` already points at our app):
```
mount -o remount,rw / ; rm -rf /usr/share/claude-thing/assets
adb push <dist>/. /usr/share/claude-thing/
adb shell supervisorctl restart chromium
```

⚠ **`@vitejs/plugin-legacy` is REQUIRED**, not an optimisation — ES modules do not load over
`file://` ("non-JavaScript MIME type of ''") and a default Vite build renders a **blank screen with
no visible error**. On vite@5 use `@vitejs/plugin-legacy@^5` (v8 demands vite@8).

## Seeing what the device actually shows

The kiosk Chromium runs `--remote-debugging-port=2222`. This is the feedback loop — use it
instead of asking someone to read the screen:

```bash
adb forward tcp:9222 tcp:2222
curl -s http://127.0.0.1:9222/json/list          # targets
# then attach to the page's webSocketDebuggerUrl and use
# Runtime.evaluate  -> document.body.innerText   (what is on screen)
# Runtime.enable    -> console + exceptions
```
Helper scripts used during bring-up live in the session scratchpad (`inspect2.mjs`, `tap2.mjs`) —
`tap2.mjs` clicks a button on the device remotely, which is how the permission loop was proven.

## Reverting to stock

```
adb shell "mount -o remount,rw / && cp /etc/supervisord.conf.stock /etc/supervisord.conf && supervisorctl restart chromium"
```
The stock Spotify webapp was never overwritten; it is still at
`/usr/share/qt-superbird-app/webapp/`.

## ⚠ No permission cards? Check the permission MODE first

`PermissionRequest` only fires when Claude Code actually **asks**. In
`bypassPermissions` (and largely in `acceptEdits`) it never asks, so **no card can ever appear**
— nothing is broken.

Observed 2026-08-02: all six live sessions were `mode=bypassPermissions`, which is the sane
default for AFK and `/crew` work. Diagnose before assuming a defect:

```bash
journalctl --user -u claude-thing.service --since "10 min ago" | grep " IN "   # hooks arriving?
curl -s http://127.0.0.1:8790/status                                           # sessions/hooks
# and dump per-session modes over the WS: claude.sessions.list -> permissionMode
```

If `IN POST /hook` lines are flowing and `sessions` is climbing, the plumbing is fine and the
answer is the mode. To exercise the path, `Shift+Tab` a session to **default** mode and run
something outside the allowlist.

**Consequence worth stating plainly:** if you drive everything in bypass, the Car Thing is a
*monitoring* surface. The permission-answering half — the part that makes it more than a
dashboard — only earns its keep on sessions that ask.

## Known open

- **`claude.usage.get` is broken here** — returns `{stale:true, error:"could not parse /usage output"}`.
  It shells to `claude -p "/usage"` and parses stdout. Host-side, unrelated to the device.
- **`claude.question.answer` is UNVERIFIED.** Upstream answers questions by typing into the focused
  terminal via macOS Accessibility APIs; no Windows equivalent ships. Wiring is correct and it now
  fails visibly rather than silently, but it has never been seen to succeed.
- The device drops off USB periodically; `car-thing-adb.service` recovers the tunnel, but ADB
  itself needs the device present.
