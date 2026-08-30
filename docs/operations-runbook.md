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

## Configuration

Env vars carry every piece of personal/host infrastructure out of the source. None default to a
real value — see `superbird.conf.example` for the full list and `INSTALL.md` for how `scripts/setup.sh`
detects/writes them. Summary:

| Var | Required? | What it is |
|---|---|---|
| `CAR_THING_SERIAL` | Auto-detected | adb device serial. Only needed once a second adb device (e.g. a phone) is ever attached — see `scripts/keep-adb-reverse.sh`. Unset = no `-s` flag, works fine with exactly one device attached. |
| `CAR_THING_ADB` | Auto-detected | Path to the `adb` binary that can see the device. Defaults to plain `adb` on PATH; on WSL2 this must be the Windows `adb.exe` (WSL2 has no USB access), which `scripts/setup.sh` probes for under `/mnt/c/`. |
| `MB_HOST` | Optional | LAN host running the fleet box — seat-occupancy fallback probes and the pcreate liveness check (`services/deviceinfo/mb.js`). **Unset = the fleet screen reports itself unconfigured; no probe is ever attempted, never a guessed LAN address.** |
| `MB_SSH_HOST` | Optional | **ssh alias**, not a host, for firing fleet actions. Deliberately an alias: user/port/key stay in ssh config and never enter this repo. Both this and `MB_HOST` must be set for any `mb.*` action to run at all. |
| `CODER_HOST` | Optional | LAN host running a second, always-on generalist model probed for the FLEET screen's health lamp (`services/deviceinfo/server.js`). ⚠ NOT localhost when set — probing `127.0.0.1` reports a healthy remote service as OFFLINE. Unset = no probe, `configured: false`. |
| `CONTROL_SCRIPTS_DIR` | Optional | Directory holding your own fleet-control scripts, substituted into `buttons.json`'s `${CONTROL_SCRIPTS_DIR}` tokens (see below). Unset = those CONTROL buttons fail per-press with ENOENT. |

`scripts/setup.sh` writes these into `superbird.conf` (gitignored) at the repo root; each systemd unit
loads it via `EnvironmentFile=` pointing at this checkout (the leading `-` tolerates a missing
file). The units in the repo are templates: `scripts/setup.sh` substitutes this checkout's path and
your `node` binary as it installs them, so nothing assumes a directory layout. Running a script directly from a shell instead, just export the vars first.
`services/deviceinfo/server.js`'s `QUEUE_ROOT`/`OBLIGATIONS_SCRIPT` are plain optional vars
pointing at projects outside this repo. They used to be derived from the service's own file
location, which only looked layout-independent — it baked in one workspace's sibling directory
names, so the path resolved for its author and silently missed for everyone else. Unset now
means unconfigured: both report "unavailable" (never fabricate a value), and the device app
does not render either block today.

**`services/deviceinfo/buttons.json`'s CONTROL grid** points at a *sibling* repo (fleet-control
scripts) outside `car-thing` entirely via the `${CONTROL_SCRIPTS_DIR}` token in every
`argv`/`stopArgv` entry — there's no path inside this repo to derive it from. Set
`CONTROL_SCRIPTS_DIR` to enable those buttons, or leave it unset and they degrade to a per-press
ENOENT (never a crash; see `loadButtons()` in `server.js`).

## The services (systemd --user)

Six units ship in this repo. `claude-thing.service` is upstream's daemon, installed separately.
`scripts/setup.sh` installs the `car-thing-*` ones; `panel-gateway.service` was installed
by hand following the same template substitution (`__REPO_ROOT__`/`__NODE_BIN__` etc.) — see the
section below for its own commands.

| Unit | Ships here | Does |
|---|---|---|
| `claude-thing.service` | no — upstream | the daemon, from `~/claude-thing/daemon` |
| `car-thing-deviceinfo.service` | yes | the `:8791` state/action service (`services/deviceinfo/server.js`) |
| `car-thing-backlight.service` | yes | the backlight attention channel (`scripts/backlight-daemon.mjs`) |
| `car-thing-rotary.service` | yes | the host-side dial bridge (`scripts/rotary-bridge.mjs`) |
| `panel-gateway.service` | yes | the `:8793` token-checked LAN gateway (`services/panel-gateway/server.js`) — see below |
| `car-thing-adb.service` | yes | re-asserts `adb reverse` every 30 s (`scripts/keep-adb-reverse.sh`) |
| `car-thing-adb-server.service` | yes | **the single adb server** — see below |

### There is exactly ONE adb server, and it must be the Windows one

On WSL2 the Car Thing is on the **Windows** USB bus, so only a Windows `adb.exe` can serve it.
But WSL and Windows share `127.0.0.1:5037` under mirrored networking, so whichever server starts
first owns the port — and if that is a Linux `adb`, **nothing** serves USB and the device is
invisible to every client.

`car-thing-adb-server.service` runs `adb.exe nodaemon server` under systemd. `nodaemon` is
load-bearing: a Windows server started from WSL and detached dies with its interop parent
(`start-server`, `Start-Process` and `cmd /c start /b` all leave nothing listening), so the
server is held in the foreground where systemd can supervise it. Every other unit is a *client*
of it — including WSL's own `/usr/bin/adb`, which reaches it over mirrored loopback.

⚠ **Every adb consumer must point at `CAR_THING_ADB`, never a bare `adb`.** On 2026-08-29 the
backlight and rotary units loaded a `.env` that pinned `CAR_THING_ADB=/usr/bin/adb`; both poll
continuously, so they kept respawning a Linux server on 5037 and the Car Thing was unreachable
for a day while all five units sat green. `car-thing-adb.service` had no `EnvironmentFile=` at
all, so it also ran unpinned and asserted the Car Thing's reverses onto the wall panel
instead. Check with:

```bash
tr '\0' '\n' < /proc/$(systemctl --user show car-thing-backlight.service -p MainPID --value)/environ | grep CAR_THING_ADB
```

`ADB_NET_DEVICES` in `superbird.conf` lists LAN devices (the wall panel) that the keeper
re-`connect`s onto this same server. It **connects only** — reverses stay pinned to
`CAR_THING_SERIAL`, deliberately: an un-tokened tunnel to `:8790` from a LAN panel would bypass
the panel-gateway bearer-token check that is the entire trust boundary there.

```bash
systemctl --user status claude-thing.service car-thing-deviceinfo.service car-thing-backlight.service
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

## Panel gateway — LAN access for the wall panel (`:8793`)

`services/panel-gateway/server.js` + the `panel-gateway.service` unit. A token-checking reverse
proxy in front of the daemon (`:8790`) and deviceinfo (`:8791`), so the wall panel — a
LAN WiFi device, not a cabled one — can reach both without `adb reverse`. Plain Node, zero npm
dependencies, same precedent as `services/deviceinfo`. It does not modify either upstream.

The prior security model (localhost + USB) was physical; a LAN client changes that, so this
gateway requires `Authorization: Bearer <token>` on **every** request, HTTP and WebSocket upgrade
alike, checked against the contents of the token file. **The token file is the entire trust
boundary** — anyone who reads it can reach the daemon and deviceinfo exactly as if plugged in.
Treat it like a credential: never commit it, never paste it in full into a committed doc, never
log it. A missing/empty token file is a fatal startup error by design; the gateway will not run
open.

| Var | Required? | What it is |
|---|---|---|
| `PG_HOST` | Optional, default `0.0.0.0` | Listen address. |
| `PG_PORT` | Optional, default `8793` | Listen port. |
| `PG_TOKEN_FILE` | Optional, default `services/panel-gateway-token.txt` | Path to the bearer token (gitignored; mint your own if it doesn't exist). |

Routing: `GET /status` and `GET /ws` (WebSocket upgrade) forward to `127.0.0.1:8790` verbatim;
anything under `/deviceinfo/...` has that prefix stripped and forwards to `127.0.0.1:8791`;
everything else is `404`. The `Authorization` header is stripped before forwarding — the upstream
services never see it. The WebSocket path is a raw TCP splice (no frame parsing), so it carries
the daemon's `/ws` protocol unmodified.

```bash
systemctl --user enable --now panel-gateway.service
systemctl --user status panel-gateway.service --no-pager
journalctl --user -u panel-gateway.service -n 50 --no-pager

# verification (run from wherever the panel will connect from):
curl -s -o /dev/null -w '%{http_code}\n' http://<host>:8793/status                                    # 401, no token
curl -s -H "Authorization: Bearer $(cat services/panel-gateway-token.txt)" http://<host>:8793/status  # daemon's real /status JSON
```

## Hooks — installed BY HAND

**Never run `claude-thing`'s `scripts/install-hooks.js`.** It rewrites `~/.claude/settings.json`
wholesale and this box has a hand-tuned config. The by-hand installer that appends only, refuses
to write if any existing entry would be lost, and backs up first:
`scripts/install-hooks-by-hand.mjs` (reproduced below). It was written in a session scratchpad
and the old path lingered here after it moved into the repo.

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
Device side (`/etc/supervisord.conf:51` already points at our app) — **run these as four
SEPARATE invocations, never chained with `&&`** (see the guard note below):
```
adb shell 'mount -o remount,rw /'
adb shell 'rm -rf /usr/share/claude-thing/assets'
adb push <dist>/. /usr/share/claude-thing/
adb shell supervisorctl restart chromium
```

🔴 **Do NOT chain the adb steps with `&&`.** The damage-control hook
(`~/.claude/hooks/damage-control/bash-tool-damage-control.py`, `is_adb_shell_command`)
already exempts `adb shell` and `adb push` from the host read-only-path guard — `/usr/...`
in those commands is a path ON THE CAR THING and cannot touch the host. But the exemption
**deliberately bails on any chained command**, because it cannot prove the second half of a
chain is also remote (`adb shell foo && rm -rf /usr/x` genuinely would be local). Chain them
and the whole line falls through to the host guard and is blocked as *"delete operation on
read-only path /usr/"*.

⚠ This is in direct tension with the "combine into one invocation" advice for a flaky ADB
window (the internal status doc §Open). Resolution: combine `reverse`/`push`/read-only steps freely,
but keep any command containing `rm` as its own unchained invocation. Cost of getting this
wrong on 2026-08-15: a deploy that appeared to be blocked by an over-strict hook, and stale
assets left on the device for the rest of the session. **The hook is correct — chaining was
the defect.**

⚠ **`@vitejs/plugin-legacy` is REQUIRED**, not an optimisation — ES modules do not load over
`file://` ("non-JavaScript MIME type of ''") and a default Vite build renders a **blank screen with
no visible error**. On vite@5 use `@vitejs/plugin-legacy@^5` (v8 demands vite@8).

## Backlight attention channel

There is **no speaker**, so light is the only out-of-band signal. `scripts/backlight-daemon.mjs`
has two inputs: it watches the daemon over the same WS protocol the device uses (sessions,
permissions), and it polls `services/deviceinfo/server.js` (`:8791/state`, every 5s) for a failed
fleet action against the primary fleet host. Both feed one state machine that drives
`/sys/class/backlight/aml-bl/brightness` (0–255) over `adb shell`.

| State | Condition | Backlight |
|---|---|---|
| **ATTENTION** (permission) | `claude.queue.list` has ≥1 ask | pulse 90↔255, ~1.1 s cycle |
| **FLEET_FAILURE** | `mb.lastResult.ok === false` latched (see below) | pulse 90↔255, ~2.2 s cycle — same range, slower cadence than ATTENTION |
| **ACTIVE** | any session `state === 'busy'` | steady 235 |
| **IDLE** | otherwise | steady 60 |
| *disconnected* | claude-thing WS down | forced steady 235 |

**Precedence (Ruling 13): ATTENTION always outranks FLEET_FAILURE.** A pending permission and a
fleet failure can be true at once; the permission wins the backlight every time — checked first in
`StateMachine#applyOnce()`. The fleet failure stays latched underneath (see below) and takes the
light back over the instant the permission clears, if it hasn't itself been superseded by then.

**FLEET_FAILURE latch/ack:** `:8791/state`'s `mb.lastResult` (`{ id, ok, ms, error? } | null`)
carries no acknowledgement signal today, and this daemon does not invent one — no new endpoint.
So a failure latches on `ok === false` and is treated as "acknowledged" only when `lastResult`
honestly moves on: a **different id** appears (whatever its outcome) or the **same id** later
reads `ok: true`. A self-clearing failure that nobody looked at will NOT un-latch — that's the
exact failure mode this tier exists to kill. The device-side banner (Phase C) is what the operator
actually dismisses on-screen; this daemon's latch is a separate, independent signal that happens
to track the same underlying `lastResult`.

**Unreachable `:8791` is NOT a fleet failure.** The deviceinfo service drops routinely (adb
bounces) just like everything else on this transport; a poll that can't reach it leaves whatever
latch state already exists untouched rather than pulsing. Crying wolf on every USB blip would
drown out the signal this tier exists to carry.

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

⚠ **Where the buttons physically are** — the top row has **FIVE** buttons, not four: presets
1-4 then **M as the fifth**. **Back is the button BELOW THE DIAL**, not on the top row. This
cost real confusion on 2026-08-15: the owner pressed Back fourteen times believing it was M,
got fourteen silent `noop`s, and reported the dial as broken. "M / front" in the old table
named the button without ever saying where it sits.

| Control | Physical position | evdev | `event.code` | Bound to |
|---|---|---|---|---|
| Preset 1 | top row, 1st | `KEY_1` (2) | `Digit1` | **Allow** · question option 1 |
| Preset 2 | top row, 2nd | `KEY_2` (3) | `Digit2` | question option 2 |
| Preset 3 | top row, 3rd | `KEY_3` (4) | `Digit3` | question option 3 |
| Preset 4 | top row, 4th | `KEY_4` (5) | `Digit4` | **Deny** · question option 4 |
| **M** | **top row, 5th** | `KEY_M` (50) | `KeyM` | fleet-nav page cycle (no ask) |
| **Back** | **below the dial** | `KEY_ESC` (1) | `Escape` | closes an open session detail — **not** inert |
| Dial press | the dial itself | `KEY_ENTER` (28) | `Enter` | **Allow** (ask pending) · fleet-nav confirm (no ask) |
| Dial rotate | the dial itself | `rotary@0` `REL_HWHEEL` | `ArrowUp`/`ArrowDown` **via the bridge** | fleet-nav cursor (no ask) |

⚠ Rotation reaches the app ONLY while `scripts/rotary-bridge.mjs` is running — the encoder has
no `kbd` handler, so nothing arrives without it. See the rotary gotcha in `docs/solutions/`.

⚠ **Back is bound, not inert.** `useHardwareKeys.ts` binds `Escape` to close an open session
detail view (`onEscape`) whenever `hasOpenDetail` is true; with no detail open it's a logged noop.
It bypasses every ask-answering guard on its own path, since closing a view can never grant a tool
call.

The dial press (`Enter`) and M now double as fleet-view controls on slot 3, but **only when no ask
is pending** — with an ask up, `Enter` stays `Allow` (question option 1) and M stays a logged noop,
exactly like every other key on the ask path. With no ask pending: `Enter` confirms the cursor's
fleet action (armed by the same two-tap confirm the touch tiles use), M cycles the fleet view's
three pages (SEATS → LEAVES → AUX), and the dial's *rotation* — once bridged, see below — moves the
cursor. These three are wired through `onNav`/`onPage`/`onConfirm` in `useHardwareKeys.ts` and are
active only while slot 3 (FLEET) is the displayed slot.

Four guards in `device/src/useHardwareKeys.ts`, each preventing a real misfire:
auto-repeat ignored (holding a button must not fire twice) · a **250 ms arm delay** after an ask
appears (a press already in flight must not blind-answer a card that just popped) · **one answer
per ask id** (the daemon round-trip is async and the card lingers) · a 150 ms `ring-2` flash on the
control that fired, because `active:` states never trigger for key input.

⚠ **The rotary dial's *rotation* is still invisible to Chromium.** `rotary@0` reports
`Handlers=event1` with **no `kbd`** — the kernel never turns a physical turn into a `keydown` this
app can see. The fix is specced as Phase A (the internal fleet-view spec): a host-side
bridge (`scripts/rotary-bridge.mjs`, sibling of `backlight-daemon.mjs`) that decodes
`/dev/input/eventN` over `adb shell` and injects `ArrowUp`/`ArrowDown` via CDP
`Input.dispatchKeyEvent`. **It is not built.** Do not read the dial press (`Enter`) as evidence the
dial works — that key comes from `KEY_ENTER`, a distinct evdev source from the rotary's rotation
events, and is unaffected by this gap. Until Phase A lands, the fleet view's page/cursor nav works
from M + touch only (Ruling 4, the internal fleet-view spec) — that is a deliberate design property,
not a placeholder.

### Debugging: `window.__klog`

The app keeps a bounded 50-entry ring buffer of every key it sees, `{code,key,repeat,t,action}`,
where `action` records the decision (`allow`, `deny`, `option:2`, `ignored:repeat`,
`ignored:arming`, `ignored:already-answered`, `noop:no-ask`, `noop`, and — no-ask branch only —
`nav:confirm`, `nav:up`, `nav:down`, `nav:page`). It is the only key-level feedback loop on this
device — read it over CDP with `Runtime.evaluate`.

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
- The device drops off USB periodically; `scripts/keep-adb-reverse.sh` recovers the tunnel, but ADB
  itself needs the device present.
