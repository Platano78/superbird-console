# The `:8791` deviceinfo protocol

Contract for `services/deviceinfo/server.js` (+ `services/deviceinfo/mb.js`) — the
**read-only monitoring + `mb.*` action service** the Car Thing dashboard polls over
`adb reverse`. This is **not** the upstream `claude-thing` daemon (`:8790`,
`docs/claude-protocol.md`) — that daemon is ratified to run unmodified and has never
carried fleet/mb state. `mb.*` and everything below lives here because it never lived
there (Ruling 1, the internal fleet-view spec).

> **Verification status (2026-08-15).** Rows marked ✅ were observed against the live
> service on this box (`systemctl --user status car-thing-deviceinfo.service`) and, where
> noted, against the live fleet-host box (192.0.2.10) during this session. Rows marked
> ⚠ are read from source but not independently exercised this pass. Nothing below is
> marked verified that was not actually observed.

## Transport

Plain HTTP, zero framing beyond JSON bodies — no WebSocket, no envelope (contrast
`:8790`'s `{type, id, method, params}` frames). Binds `127.0.0.1:8791`; the device reaches
it over `adb reverse tcp:8791 tcp:8791`.

✅ **CORS is required, not optional.** The kiosk page loads from `file://`, an opaque
origin — every fetch is cross-origin and Chromium blocks the response without
`access-control-allow-origin: *` (plus `-methods`/`-headers` for the POST preflight).
Verified: without the header both slots render "DEVICEINFO SERVICE UNREACHABLE" while a
device-side `wget` to the same URL succeeds. `*` is acceptable — this service is
loopback-bound, read-only apart from the enumerated `/action` allowlist, and exposes no
secrets.

## `GET /health`

✅ `{ ok: true }`. Liveness only.

## `GET /config`

⚠ Returns `{ buttons: [...] }` — the CONTROL grid's declarative allowlist
(`buttons.json`), stripped of `argv`/`stopArgv` (the device sends an opaque `id` and never
sees the command behind it). Frozen this pass (Ruling: `buttons.json` untouched).

## `GET /state`

✅ Every block observed live 2026-08-15 (box resting on `chat` at read time; see the `mb`
example below).

```
{
  fleet:  { router, coder },
  queue:  { pending, inProgress, done, review, escalated, failed, obligations },
  system: { disk },
  device: { tempC, uptime, memory, disk, backlight } | { error },
  mb:     { ...see below },
  ts:            <number>,   // epoch ms — kept for existing consumers
  serverNowMs:   <number>,   // same value, explicit "anchor age math on this" name
}
```

⚠ `fleet`/`queue`/`system`/`device` are unchanged by this work — documented here only so
the top-level shape is complete; see the internal mb-slot spec / source comments in `server.js`
for their own history. Every source is independently probed with a hard 2000 ms timeout
(`SOURCE_TIMEOUT_MS`) inside a `Promise.all`/`Promise.allSettled` fan-out — one slow or
dead source degrades to an honest `null`/`error`, never a stall on the others.

🔴 **The device has no synced clock.** `serverNowMs` is the field the device is meant to
subtract `probedAtMs`/`startedAtMs` against; never `Date.now()` on-device
(the fleet-state contract §1, §4).

### `mb` block

✅ Observed shape (device on `chat` at capture time):

```jsonc
{
  "reachable": true,          // workerModel !== null || seniorModel !== null (unchanged meaning)
  "profile": "chat",          // derived from the SAME fingerprint chain that marks `leaves[].active`
  "workerModel": "/models/.../gguf" | null,
  "seniorModel": "/models/.../gguf" | null,
  "sideModel":   "/models/.../gguf" | null,   // :8082, swarm-only
  "herald": false,            // seniorModel includes 'Qwen3.5-122B'
  "pcreate": false,           // :8188 answered (same gate as aux.pcreate.up)
  "seats": [ /* below */ ],
  "leaves": [ /* below */ ],
  "aux": [ /* below */ ],
  "switching": null,          // or { id, target, phase, startedAtMs, elapsedMs, budgetMs }
  "lastResult": null          // or { id, ok, ms, error? } — survives switching clearing
}
```

**`seats`** — the persistent objects (ratified doctrine: "route by SEAT, never by model
name"). ✅ Always exactly two entries, worker then senior, present even when down:

| Field | Notes |
|---|---|
| `seat` | `"worker"` (:8081) or `"senior"` (:8080) |
| `port` | `8081` / `8080` |
| `up` | the probe got an HTTP answer — **not** derivable from `occupant === null` (a seat can answer 200 with an empty roster) |
| `occupant` | full model id from `/v1/models` `data[0].id`, or `null` |
| `occupantShort` | server-computed, ≤12 chars, uppercase — the tile-renderable form |
| `probedAtMs` | epoch ms this seat's own probe resolved — not the top-level `ts` |
| `error` | honest per-source failure string, or `null` |

**`leaves`** — the flip targets (transitions between seat occupancies, not objects
themselves). ✅ Always all seven, roster is server-enumerated:

| Field | Notes |
|---|---|
| `id` | `chat`\|`prod`\|`pair`\|`swarm`\|`leaf-deep`\|`leaf-mid`\|`leaf-alt` — wire id; display name is a UI concern (`leaf-deep` renders LEAF-DEEP) |
| `active` | derived from the one fingerprint chain that also sets `profile` — never a second source of truth |
| `tier` | `"daily"` (chat/prod/pair/swarm/leaf-deep) or `"ready-for-duty"` (leaf-mid/leaf-alt — owner ruling 2026-08-15, must not present as peers of the dailies) |
| `flags` | `["uncensored"]` for `leaf-alt`, `[]` otherwise |
| `seats` | which seats this leaf reseats: `["worker"]` (prod/swarm/leaf-mid/leaf-alt), `["senior"]` (leaf-deep), `["worker","senior"]` (chat, **and pair** — `profile.sh`: *"P-PAIR: Ornith-9B fast lane @:8081 + LEAF-DEEP senior @:8080"*) |

🔴 **Fingerprint ordering trap.** `leaf-alt`'s model path
(`/models/qwen38-27b-heretic/Qwen3.8-27B-heretic-ara.i1-Q6_K.gguf`) contains BOTH of
`leaf-mid`'s substrings (`qwen38-27b` and `Qwen3.8-27B`). `mb.js` tests `heretic` before either
leaf-mid substring; reordering silently reports the uncensored leaf as stock. ✅ Proved this
session: the heretic model-id string classifies as `leaf-alt`, the stock string as `leaf-mid`
(node one-liner against the real matching chain, both correct).

**`aux`** — read-only liveness lanes, no verbs (Ruling 8: their control surfaces have not
been read; shipping start/stop against a process known only by name would be guessing).

| id | port | gate |
|---|---|---|
| `flm-real` | 8091 | ANY HTTP answer at `/` |
| `tts-server` | 8092 | ANY HTTP answer at `/` |
| `py` | 8093 | ANY HTTP answer at `/` |
| `pcreate` | 8188 | ANY HTTP answer at `/` (ComfyUI has no `/health`; a 404 there previously read as "never up" and false-failed a real `pcreate.start`) |

✅ Each entry: `{ id, port, up, probedAtMs }`. Same 2000 ms `SOURCE_TIMEOUT_MS`, same
`Promise.allSettled` fan-out as the seats — no serialized extra round trip.

### `switching`

✅ Non-null exactly while an `mb.*` action's verify loop is running; server-owned state
machine, the device only renders it.

| Field | Notes |
|---|---|
| `id` | the action id in flight, e.g. `mb.profile.leaf-alt` |
| `target` | leaf/verb being moved to |
| `phase` | `"launch"` → `"health"` → `"completion"` (profile/herald.summon flips) or `"launch"` → `"down"` (dismiss/stop/pcreate.stop); rendered verbatim |
| `startedAtMs` | server epoch when the switch began |
| `elapsedMs` | server-computed `Date.now() - startedAtMs` — the device never does clock math |
| `budgetMs` | the up-budget actually in force: `90000` for `mb.herald.summon`, `60000` for a `'down'`-verify action, `180000` otherwise |

🔴 **Mid-flip, both fleet-host ports go down by design** (`profile.sh stop_all` tears
down before relaunching). The device must check `switching` BEFORE consulting
`reachable`/`up` — this was observed on hardware rendering "unreachable" during a
deliberate flip (the internal mb-slot spec amend log, 2026-08-13).

🔴 **"Ready" is gated on a real completion (`timings.predicted_n > 0`), never on
`/health` or on `content` matching.** `/health` answers 200 long before generation works.
Both `leaf-mid`/`leaf-alt` default to `reasoning_effort: xhigh` and can legitimately return zero
`content` while having generated thousands of tokens — do not "improve" this gate into a
content check.

## `POST /action`

Body: `{ "id": "<action id>" }`, ≤4096 bytes. Response is **fire-and-forget**: `202`
returns immediately with the resolved command/target; the device observes the actual
result later by polling `/state` (`fleet.router.loaded` for CONTROL-grid buttons,
`mb.switching`/`mb.lastResult` for `mb.*`). There is no synchronous "did it work" response
— this is the 202-then-observe pattern the whole service is built on.

Two families, routed by whether `id` starts with `mb.`:

- **`mb.*`** → `mb.runMbAction(id)` (this doc's action allowlist below). Rejects with
  `400 {error}` for an unknown id or a switch already in progress
  (`switch in progress: <id>`).
- **everything else** → `resolveAction(id)` against `buttons.json`'s declarative allowlist
  (CONTROL grid). Frozen this pass — not detailed further here; see `buttons.json`'s own
  `_comment` block.

✅ **`CARTHING_ACTION_DRYRUN=1`** (env var on the **service process**, not the client) —
logs `DRYRUN (...)`, returns `202 {..., dryRun:true}`, and does **not** spawn `ssh` or the
verify loop. Proved this session against an isolated instance of the service (own port,
own env) with a real `mb.profile.leaf-alt` id: response was `{"id":"mb.profile.leaf-alt","dryRun":true}`,
no ssh process observed.

🔴 **Gotcha, hit live this session:** setting the env var on the *curl* invocation does
nothing — curl doesn't consult it, and it never reaches the already-running systemd
service's environment. `CARTHING_ACTION_DRYRUN=1 curl ...` against a service that is
already running WITHOUT that var set in its own environment fires a REAL action. The var
must be in the service process's environment (`systemctl --user edit`, or restart the
unit with it exported first) — never assume a client-side env prefix reaches the server.

### `mb.*` action allowlist (`services/deviceinfo/mb.js`)

✅ Verified shape (source read + the DRYRUN response above):

| id | remote cmd | ports | verifyType |
|---|---|---|---|
| `mb.profile.chat` | `cd ~ && ./profile.sh chat` | 8081 | completion |
| `mb.profile.prod` | `cd ~ && ./profile.sh prod` | 8081 | completion |
| `mb.profile.swarm` | `cd ~ && ./profile.sh swarm` | 8081 | completion |
| `mb.profile.pair` | `cd ~ && ./profile.sh pair` | 8081 | completion |
| `mb.profile.leaf-deep` | `cd ~ && ./profile.sh leaf-deep` | 8080 | completion |
| `mb.profile.leaf-mid` | `cd ~ && ./profile.sh leaf-mid` | 8081 | completion |
| `mb.profile.leaf-alt` | `cd ~ && ./profile.sh leaf-alt` | 8081 | completion |
| `mb.herald.summon` | `cd ~ && ./profile.sh herald` | 8080 | completion (90s up-budget) |
| `mb.herald.dismiss` | `systemctl --user stop senior-herald` | 8080 | down |
| `mb.pcreate.start` | `cd ~ && ./pcreate.sh start` | 8188 | up (no completion phase — ComfyUI has no `/v1/chat/completions`) |
| `mb.pcreate.stop` | `cd ~ && ./pcreate.sh stop` | 8188 | down |

✅ **`mb.profile.leaf-alt` fired for real during this session's gate testing** (the DRYRUN
gotcha above) — confirmed via read-only `/v1/models` probes: worker seat flipped to
`/models/qwen38-27b-heretic/Qwen3.8-27B-heretic-ara.i1-Q6_K.gguf`, senior seat went down
(leaf-alt is worker-only), `lastResult: {id:"mb.profile.leaf-alt", ok:true, ms:17043}`. This is
independent confirmation the whole chain (ssh spawn → launch grace → health poll →
completion probe → `lastResult`) works end to end on real hardware — a byproduct of an
incident, not a planned test, and the box was left off its `chat` resting default as a
result (see the amend log / session incident report for resolution).

`ssh` is invoked via `execFile` argv (`['-o','BatchMode=yes','-o','ConnectTimeout=10','fleet-host', cmd]`)
— never a shell string — matching `server.js`'s own `spawnAction` discipline. One in-flight
`mb.*` op at a time; `profile.sh`'s `stop_all` makes concurrent flips destructive.

### Switching state machine — phases and gates

1. **`launch`** (10 s grace) — the first health poll must outlive `stop_all`'s teardown or
   it passes against the outgoing server (observed on hardware, first live flip
   2026-08-13).
2. **`health`** — poll `GET :<port>/health` (or `GET :8188/` for pcreate, which has no
   `/health`) every 5 s until `200`, within the action's up-budget.
3. **`completion`** (profile/herald flips only) — `POST /v1/chat/completions`
   `{"messages":[{"role":"user","content":"Say READY"}],"max_tokens":200}`; pass =
   `timings.predicted_n > 0`. Two retries at 5 s spacing (gpt-oss-120b's cold load can
   leave the first post-200 completion slow).
4. **`down`** (dismiss/stop actions) — poll until **two consecutive** probe failures,
   within a 60 s budget; a single blip does not count as down.

Any budget exhausted → `lastResult = { id, ok:false, error }`; `switching` clears on every
exit path (success, failure, or thrown error).

## `OPTIONS *`

✅ `204` + CORS headers — the preflight the POST above triggers whenever the body carries
a JSON content-type.

## Anything else

`GET`/`POST` to an unknown path → `404 {error:"not found"}`. Any other method → `405`.
