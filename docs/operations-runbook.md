# Operations runbook — how the Car Thing surface runs

> ✅ **The core goal is met (2026-08-02).** Real permission prompts from a real session were
> answered from the device while the owner was away from the keyboard:
> ```
> 01:22:36  PB permission bfde5ae8 -> allow   (…/render/vehicles/types.ts, 3s)
> 01:22:45  PB permission 553b51fd -> allow   (…/player/VehicleCamera.ts,  2s)
> 01:22:59  PB permission 5f40bd37 -> allow   (…/player/VehiclePanel.ts,   8s)
> 01:23:06  PB permission b761b91f -> allow   (…/app/deploy.ts,          1.6s)
> 01:23:47  PB permission 92bf5956 -> timeout (unanswered → fell through at 30s)
> ```
> The timeout line is the 30 s hold working as intended: unanswered prompts return to the
> terminal instead of stalling it. At upstream's 595 s that terminal sits silent for ~10 minutes.

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
| `car-thing-backlight.service` | the backlight attention channel (`scripts/backlight-daemon.mjs`) |

```bash
systemctl --user status claude-thing.service car-thing-adb.service car-thing-backlight.service
systemctl --user restart claude-thing.service
journalctl --user -u claude-thing.service -n 50 --no-pager
curl -s http://127.0.0.1:8790/status        # the one-line health check
```

Healthy `/status` looks like:
`{"sessions":5,...,"clients":{"car-thing":1,"backlight":1},"sources":["poller","hooks"],"hooks":true}`

- `clients.car-thing` — the device is connected. Missing → `adb reverse` is down.
- `clients.backlight` — the backlight service's own WS client. Expected, not an intruder.
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

## Backlight attention channel

There is **no speaker**, so light is the only out-of-band signal. `scripts/backlight-daemon.mjs`
watches the daemon over the same WS protocol the device uses and drives
`/sys/class/backlight/aml-bl/brightness` (0–255) over `adb shell`.

| State | Condition | Backlight |
|---|---|---|
| **ATTENTION** | `claude.queue.list` has ≥1 ask | pulse 90↔255, ~1.1 s cycle |
| **ACTIVE** | any session `state === 'busy'` | steady 235 |
| **IDLE** | otherwise | steady 60 |
| *disconnected* | WS down | forced steady 235 |

Plus an **edge-triggered** burst when a `week-*` limit crosses 90% — three quick full-range
pulses, once. ⚠ Edge, not level: a weekly limit sits above 90% for *days*, so a level-triggered
pulse would be intolerable and would drown out the ATTENTION signal that actually needs
answering. Fired keys persist to `~/.local/state/car-thing/backlight.json` keyed by the limit's
reset label, so a restart doesn't re-alert and a new period re-arms.

**Disconnected goes bright, not dim or pulsing** — the light must never signal attention that
nothing is backing.

### ⚠ The stock ambient-light daemon fights you

`sp-als-backlight` continuously re-drives the backlight toward its own ambient target. Measured:
write 60, and it climbs back at **~26 units/sec** (`61, 74, 87, 100, 113…`). IDLE could never hold.

It is **supervised** — `/etc/supervisord.conf` has `[program:backlight]` → `command=sp-als-backlight`
with `autorestart=true`, so **`kill` is the wrong lever; it just respawns.** The right one:

```bash
adb shell "supervisorctl stop backlight"    # brightness then holds flat
adb shell "supervisorctl start backlight"   # hand it back
```

The service does exactly this — stops it on startup, restarts it on SIGTERM — so
`systemctl --user stop car-thing-backlight` leaves the device in **stock** condition. Nothing is
written to `/etc/supervisord.conf`; `autostart=true` brings ALS back on reboot and the service
re-takes it next run. That self-healing property is deliberate.

⚠ `actual_brightness` does **not** read back what you wrote — the driver rounds (write 234 → read
235; write 172 → read 173). Never assert exact equality on a readback.

### Verifying it

```bash
node scripts/backlight-daemon.mjs --self-test   # walks every state on the real device, restores 235 + ALS
```
For a true end-to-end check, inject a permission (below) and sample brightness while it is
pending — you should see the ramp, then a settle to 235 once answered.

## Physical controls

`gpio-keys` is `kbd`-handled, so Chromium receives the buttons as ordinary `keydown` events on
`window`. The mapping was confirmed 2026-08-02 from two independent layers that agreed exactly —
the kernel capability bitmap plus a real press captured at both the evdev and DOM level:

| Control | evdev | `event.code` | Bound to |
|---|---|---|---|
| Preset 1 | `KEY_1` (2) | `Digit1` | **Allow** · question option 1 |
| Preset 2 | `KEY_2` (3) | `Digit2` | question option 2 |
| Preset 3 | `KEY_3` (4) | `Digit3` | question option 3 |
| Preset 4 | `KEY_4` (5) | `Digit4` | **Deny** · question option 4 |
| Dial press | `KEY_ENTER` (28) | `Enter` | **Allow** · question option 1 |
| Back | `KEY_ESC` (1) | `Escape` | **deliberately inert** |
| M / front | `KEY_M` (50) | `KeyM` | **deliberately inert** |

⚠ **Back and M are unbound on purpose.** The back button sits where a hand lands when picking the
device up, and a physical press answers a permission with no confirmation step. They are still
logged, so a future session can see they arrive.

Four guards in `device/src/useHardwareKeys.ts`, each preventing a real misfire:
auto-repeat ignored (holding a button must not fire twice) · a **250 ms arm delay** after an ask
appears (a press already in flight must not blind-answer a card that just popped) · **one answer
per ask id** (the daemon round-trip is async and the card lingers) · a 150 ms `ring-2` flash on the
control that fired, because `active:` states never trigger for key input.

⚠ **The rotary dial's *rotation* is not bound and is not a listener job.** `rotary@0` reports
`Handlers=event1` with **no `kbd`** — Chromium cannot see it. It needs an evdev→uinput bridge.

### Debugging: `window.__klog`

The app keeps a bounded 50-entry ring buffer of every key it sees, `{code,key,repeat,t,action}`,
where `action` records the decision (`allow`, `deny`, `option:2`, `ignored:repeat`,
`ignored:arming`, `ignored:already-answered`, `noop:no-ask`, `noop`). It is the only key-level
feedback loop on this device — read it over CDP with `Runtime.evaluate`.

### Injecting a real permission to test with

`PermissionRequest` only fires when a session actually asks, and everything runs in
`bypassPermissions` (see below). To exercise the whole chain without waiting for one, POST a real
hook — this goes through the genuine bridge, queue, WS and device path:

```bash
curl -s --max-time 45 -X POST http://127.0.0.1:8790/hook \
  -H 'Content-Type: application/json' \
  -d '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo TEST"}}'
```
A card appears on the device; answering it returns `{"decision":{"behavior":"allow"}}` to the
caller — exactly what Claude Code would act on — and the journal logs
`PB permission <id> -> allow`. **That log line is the only proof that counts.**

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
⚠ **This restores the config, not the stock UI — corrected 2026-08-10 on hardware.** The claim
that "the stock Spotify webapp was never overwritten" is **FALSE on this device**. Read from the
live unit:

```
$ adb shell "grep -o '<title>[^<]*</title>' /usr/share/qt-superbird-app/webapp/index.html"
<title>DeskThing Client</title>
```

DeskThing overwrote that directory (there is also a nested `webapp/webapp/`, likewise DeskThing;
`grep -rl Superbird /usr/share/` returns nothing). `supervisord.conf.stock` still points at that
path, so this command boots **the DeskThing client**, not the Spotify UI. The original Spotify
webapp is **not recoverable from the device** — only by reflashing.

Consequence for `firmware-decision.md`'s "the stock Spotify webapp is left intact, so reverting is
a one-line edit": the one-line edit still restores *our* pre-`claude-thing` state, which is what it
was actually protecting. It does not restore factory.

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

- ~~`claude.usage.get` is broken~~ ✅ **FIXED 2026-08-02.** Root cause was **`ANTHROPIC_API_KEY`
  in the daemon's environment.** With a key set, Claude Code runs in API mode and `/usage`
  prints a cost summary (`Total cost: $0.00`) instead of the plan-limits panel — so the parser,
  which was correct all along, had nothing to match. The service now runs
  `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN`, and all three limits parse:
  `SESSION` (the 5h window), `WEEK · ALL MODELS`, and `WEEK · FABLE` (per-model).
  **Generalisable:** if a `claude` subprocess behaves as though there is no subscription,
  check the auth env before suspecting the caller.
- **`claude.question.answer` is UNVERIFIED.** Upstream answers questions by typing into the focused
  terminal via macOS Accessibility APIs; no Windows equivalent ships. Wiring is correct and it now
  fails visibly rather than silently, but it has never been seen to succeed.
- The device drops off USB periodically; `car-thing-adb.service` recovers the tunnel, but ADB
  itself needs the device present.
