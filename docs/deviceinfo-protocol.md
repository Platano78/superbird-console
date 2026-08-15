# The `:8791` deviceinfo protocol

Contract for `services/deviceinfo/server.js` (+ `services/deviceinfo/mb.js`) — the
**read-only monitoring + `mb.*` action service** the Car Thing dashboard polls over
`adb reverse`. This is **not** the upstream `claude-thing` daemon (`:8790`,
`docs/claude-protocol.md`) — that daemon is ratified to run unmodified and has never
carried fleet/mb state. `mb.*` and everything below lives here because it never lived
there (Ruling 1, the internal fleet-view spec).

> **Status (2026-08-15, rework pass).** fleet-aggregator published `fleet-state/1`
> (`fleet-aggregator/docs/fleet-state-contract.md`) as the schema of record for fleet state, AFTER
> this service had already shipped its own (worse, duplicated) shape. This service no
> longer re-derives fleet state by polling `/v1/models` itself — it fetches fleet-aggregator's
> aggregator and re-exports the document verbatim. See the fleet-state contract
> for the full delta history against the contract. Rows below marked ✅ were re-verified
> against a live instance of this service (non-default port, scratch process) this pass.

## Transport

Plain HTTP, zero framing beyond JSON bodies — no WebSocket, no envelope (contrast
`:8790`'s `{type, id, method, params}` frames). Binds `127.0.0.1:8791`; the device reaches
it over `adb reverse tcp:8791 tcp:8791`.

✅ **CORS is required, not optional.** The kiosk page loads from `file://`, an opaque
origin — every fetch is cross-origin and Chromium blocks the response without
`access-control-allow-origin: *` (plus `-methods`/`-headers` for the POST preflight).
`*` is acceptable — this service is loopback-bound, read-only apart from the enumerated
`/action` allowlist, and exposes no secrets.

## `GET /health`

✅ `{ ok: true }`. Liveness only.

## `GET /config`

Returns `{ buttons: [...] }` — the CONTROL grid's declarative allowlist (`buttons.json`),
stripped of `argv`/`stopArgv` (the device sends an opaque `id` and never sees the command
behind it). Unchanged by this pass.

## `GET /state`

✅ Every block re-observed live this pass.

```
{
  fleet:            { router, coder },
  queue:            { pending, inProgress, done, review, escalated, failed, obligations },
  system:           { disk },
  device:           { tempC, uptime, memory, disk, backlight } | { error },
  mb:               { switching, lastResult },   // controller-owned state ONLY
  fleet_state:      { ... } | null,               // fleet-state/1, VERBATIM pass-through
  fleet_state_error: <string> | null,             // set iff fleet_state is null
  fleet_fallback:   { probedAtMs, seats } | null, // seat-occupancy fallback, SIBLING of fleet_state
  ts:               <number>,   // epoch ms
}
```

`fleet`/`queue`/`system`/`device` are unchanged by this work — documented here only so
the top-level shape is complete; see the internal mb-slot spec / source comments in `server.js`
for their own history. Every source is independently probed with a hard 2000 ms timeout
(`SOURCE_TIMEOUT_MS`) inside a `Promise.all`/`Promise.allSettled` fan-out — one slow or
dead source degrades to an honest `null`/`error`, never a stall on the others.

🔴 **`serverNowMs` is GONE.** The contract carries per-probe `age_s` on every observation,
which is strictly better than a second server clock — two clocks is how consumers start
disagreeing. `ts` remains for existing non-`mb` consumers.

### `fleet_state` — pass-through of `fleet-state/1`

**This service does not own this schema and does not restate it here.** `fleet_state` is
`GET http://localhost:8095/fleet-state.json` (The fleet aggregator) fetched and
re-exported **byte-for-byte** under this key — unknown fields untouched, nothing
whitelisted or reshaped, per the contract's law 7 (additive evolution, consumers ignore
unknown keys). For the schema itself — `hosts[]`, `seats[]`, `leaf`, `thermals`,
`commands`, `warnings`, and the seven design laws that make the shape non-obvious — read
`fleet-aggregator/docs/fleet-state-contract.md`. Do not copy fields from it into this file; that file
is the schema of record and its own change protocol explicitly forbids a second copy.

✅ Observed live: `fleet_state.schema === "fleet-state/1"`, `hosts[]` present with `seats`
and `commands` on each host.

- `mb.readFleetState()` (`services/deviceinfo/mb.js`) does the fetch, with an
  `AbortController` timeout of 4000 ms — deliberately well above this service's own
  2000 ms `SOURCE_TIMEOUT_MS`, because a client timeout equal to (or below) the timeout it
  is racing against loses every time. This is the same trap already documented in
  `device/src/deviceInfo.ts:75-86` against THIS service's own timeout; it applies again
  one hop further out.
- **Failure is never fabricated.** If the aggregator is unreachable, answers non-200, or
  returns something that isn't a JSON object, `fleet_state: null` and `fleet_state_error`
  names the reason (`"http 503"`, `"invalid JSON: ..."`, a network error message, etc.).
  There is **no fallback to probing fleet-host directly** — that would resurrect the
  duplicate leaf-inference logic the contract exists to forbid. A consumer that needs
  fleet state and sees `fleet_state: null` should render "fleet state unavailable", not
  synthesize a guess.

### `fleet_fallback` — seat-occupancy-only availability fallback

✅ Observed live (aggregator forced `doc: null`, real fleet-host probed):

```json
{
  "probedAtMs": 1786822383646,
  "seats": [
    { "id": "worker", "port": 8081, "up": true, "occupant": "/models/gemma4-26b-a4b-qat/gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf" },
    { "id": "senior", "port": 8080, "up": true, "occupant": "/models/gpt-oss-120b/Q4_K_M/gpt-oss-120b-Q4_K_M-00001-of-00002.gguf" }
  ]
}
```

The aggregator (`http://localhost:8095/fleet-state.json`) is the ONE producer of
`fleet-state/1` (`fleet-aggregator/docs/fleet-state-contract.md`), and `readFleetState()` correctly
refuses to re-derive anything when it's unreachable — that's contract-correct, but it
also leaves the device fully blind whenever the desktop aggregator process is down, for
an always-on glanceable device. `fleet_fallback` is a narrow, explicitly degraded
availability fallback for exactly that gap:

- **A SIBLING of `fleet_state`, never merged into it.** `fleet_fallback` is `null`
  whenever `fleet_state` is non-null (the happy path) — `mb.readFleetFallback(doc)`
  takes the SAME `doc` `readFleetState()` just returned and returns `null` on its very
  first line if `doc` is truthy, before issuing any probe. A consumer can never
  mistake this degraded local read for the contract document, because the two keys are
  structurally distinct and mutually exclusive: exactly one of them is non-null at a
  time.
- **Seat occupancy ONLY — no leaf/profile inference.** This probes the two known
  fleet-host seats (`worker` :8081, `senior` :8080 — the same `MB_HOST` this service
  already talks to for `mb.*` actions) directly via `GET /v1/models`, and reports
  `models[0].name` **verbatim**. It does not infer, derive, or guess a leaf/profile
  name (`chat`/`prod`/`leaf-alt`/`leaf-deep`/etc.) from that string via substring matching —
  that logic was deliberately deleted from this file (see the removal note at the
  bottom of `mb.js`) and stays fleet-aggregator's job alone, forever
  (`fleet-aggregator/tools/fleet_probe.py` — "one producer, many consumers").
- **`reachable` and `occupant` are independent, not collapsed.** A seat that answers
  200 with an empty `models` array is `up:true, occupant:null` — genuinely empty, not
  down. A seat that times out, refuses the connection, answers non-200, or returns
  unparseable JSON is `up:false, occupant:null` — unreachable, distinct from empty.
  This matters because fleet-state/1 itself treats these as different states (empty ≠
  loading ≠ unreachable); collapsing "no model loaded" into the same signal as "can't
  reach the box at all" would make this fallback confidently wrong about a live server.
- **Never throws.** `Promise.allSettled` fan-out, per-seat try/catch inside
  `probeSeatOccupant()` — a probe failure yields `{reachable:false, occupant:null}`,
  never a rejection into `buildState()`.

Shape:

```jsonc
{
  "probedAtMs": <number>,       // epoch ms this fan-out ran
  "seats": [
    { "id": "worker", "port": 8081, "up": <bool>, "occupant": <string> | null },
    { "id": "senior", "port": 8080, "up": <bool>, "occupant": <string> | null }
  ]
}
```

`up:false` means the seat's `/v1/models` was unreachable, non-200, timed out, or
returned unparseable JSON. `up:true, occupant:null` means the seat answered but no
model is currently loaded. `up:true, occupant:"<path>"` is the raw model path string,
never parsed or mapped to anything.

### `mb` block — controller-owned state only

✅ Observed shape:

```jsonc
{
  "switching": null,   // or { id, target, phase, startedAtMs, elapsedMs, budgetMs }
  "lastResult": null   // or { id, ok, ms, error? } -- survives switching clearing
}
```

Per the fleet-state contract §4, `fleet-state/1` is an **observation**
document; `switching` and `lastResult` are this service's own **controller** state and
are not proposed for the schema. Everything previously invented here — `reachable`,
`profile`, `workerModel`, `seniorModel`, `sideModel`, `herald`, `pcreate`, `seats`,
`leaves`, `aux` — has been **deleted**; that information now lives in `fleet_state`.

| Field | Notes |
|---|---|
| `switching.id` | the action id in flight, e.g. `mb.profile.leaf-alt` |
| `switching.target` | leaf/verb being moved to |
| `switching.phase` | `"launch"` → `"health"` → `"completion"` (profile/herald.summon flips) or `"launch"` → `"down"` (dismiss/stop/pcreate.stop); rendered verbatim |
| `switching.startedAtMs` / `elapsedMs` / `budgetMs` | server-computed; device never does clock math |
| `lastResult` | terminal outcome of the most recent action this service fired |

🔴 **Mid-flip, both fleet-host ports go down by design** (`profile.sh stop_all` tears
down before relaunching). A consumer should check `switching` (and, once wired,
`fleet_state`'s `leaf.transition`) BEFORE reading `fleet_state`'s seat states as "down" —
this was observed on hardware once already (the internal mb-slot spec amend log, 2026-08-13),
before the contract existed to carry `leaf.transition` for exactly this case.

🔴 **"Ready" is gated on a real completion (`timings.predicted_n > 0`), never on
`/health` or on `content` matching.** `/health` answers 200 long before generation works.
This is now also the contract's own law 4 (`ready` is generation-gated).

## `POST /action`

Body: `{ "id": "<action id>", "confirm_token"?: "<token>", "dry_run"?: true }`,
≤4096 bytes. Response is **fire-and-forget** for an executed action: `202` returns
immediately; the device observes the actual result later by polling `/state`
(`fleet.router.loaded` for CONTROL-grid buttons, `mb.switching`/`mb.lastResult` for
`mb.*`). There is no synchronous "did it work" response for an executed action — this is
the 202-then-observe pattern the whole service is built on.

Two families, routed by whether `id` starts with `mb.`:

- **`mb.*`** → `mb.runMbAction(id, { confirm_token, dry_run })` (allowlist below).
  Rejects with `400 {error}` for an unknown id, a switch already in progress
  (`switch in progress: <id>`), or a rejected `confirm_token`.
- **everything else** → `resolveAction(id)` against `buttons.json`'s declarative allowlist
  (CONTROL grid). Unchanged this pass — see `buttons.json`'s own `_comment` block.

### Two-step confirm + payload dry-run (mb.\* only)

🔴 **Design change, prompted by a real incident.** A single `POST /action {id}` used to
fire a live leaf flip on a serving box immediately. During this session's own gate
testing, someone set `CARTHING_ACTION_DRYRUN=1` on the **`curl` invocation** instead of
the **service process's** environment — curl doesn't consult it, and it never reached the
already-running systemd service, so a REAL flip ran against fleet-host. See the trap
call-out below; this is why the flow changed.

The action flow is now two calls:

1. **`POST /action {"id": "mb.profile.leaf-alt"}`** (no `confirm_token`) → does **not**
   execute anything. Returns:
   ```json
   {
     "id": "mb.profile.leaf-alt",
     "target": "leaf-alt",
     "confirm_token": "<32-hex-char single-use token>",
     "expires_in_s": 30,
     "would": { "id": "...", "target": "leaf-alt", "cmd": "cd ~ && ./profile.sh leaf-alt", "ports": [8081], "verifyType": "completion" }
   }
   ```
   The token is bound to this exact `id`, expires in ~30 s, and is single-use.
2. **`POST /action {"id": "mb.profile.leaf-alt", "confirm_token": "<token from step 1>"}`**
   → executes iff the token matches the pending one, is unexpired, unused, and bound to
   this same `id`. A token that is wrong, expired, already used, or issued for a
   different action id is rejected with `400 {"error": "confirm_token rejected: <reason>"}`
   (`no pending confirmation` / `confirm_token already used` / `confirm_token expired` /
   `confirm_token bound to a different action id` / `confirm_token mismatch`) — **nothing
   is spawned** on rejection.

`dry_run: true` **in the request payload** is the honest per-request dry-run mechanism —
independent of `confirm_token` entirely. `POST /action {"id": "...", "dry_run": true}`
echoes the exact `would` command and executes nothing, regardless of whether a
`confirm_token` is also present.

✅ **`CARTHING_ACTION_DRYRUN=1`** (env var on the **service process**, not the client) is
kept as a coarser global kill-switch, checked first in `server.js` before `mb.*` reaches
`mb.runMbAction` at all — logs `DRYRUN (mb, env kill-switch, not spawned)`, returns
`202 {..., dry_run:true}`.

🔴 **Documented trap: an env var on the CLIENT is meaningless.**
`CARTHING_ACTION_DRYRUN=1 curl ...` against a service that is already running WITHOUT
that var set in its own environment fires a REAL action — curl does not read or forward
the shell variable to the server process. The var must be set in the service process's
own environment (`systemctl --user edit ...` or restarting the unit with it exported
first). This is the incident that motivated the `confirm_token` flow above: an env-var
mistake on the client side can no longer, by itself, cause a real flip — the payload
`dry_run` flag and the two-step confirm are per-request and cannot be silently bypassed
by a misconfigured shell.

✅ Verified this pass (isolated instance, non-default port, no real device/box touched):
- `{"id":"mb.profile.leaf-alt"}` → returned a `confirm_token`, `would`, spawned nothing.
- `{"id":"mb.profile.leaf-alt","confirm_token":"<wrong>"}` → `400`, `confirm_token mismatch`,
  spawned nothing.
- `{"id":"mb.profile.leaf-alt","dry_run":true}` → echoed `would`, spawned nothing.
- No `ssh` process observed for any of the three, and the action log shows only
  `confirm-issued` / `confirm-rejected` / `DRYRUN-payload` lines — never `verify-start`.

### `mb.*` action allowlist (`services/deviceinfo/mb.js`)

Unchanged from the prior pass — the ACTIONS stayed; only the state DERIVATION moved to
the contract:

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

`ssh` is invoked via `execFile` argv (`['-o','BatchMode=yes','-o','ConnectTimeout=10','fleet-host', cmd]`)
— never a shell string — matching `server.js`'s own `spawnAction` discipline, and only
after a valid `confirm_token` is presented. One in-flight `mb.*` op at a time;
`profile.sh`'s `stop_all` makes concurrent flips destructive — unchanged, hardware-proven.

### Switching state machine — phases and gates (unchanged, hardware-proven)

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
