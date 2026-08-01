# The `claude.*` protocol

Extracted from `rithkott/claude-thing` → `protocol/claude-protocol.md`.
**Firmware-agnostic** — this contract survives the decision to drop the Nocturne fork.

> **Verification status (2026-08-01).** Rows marked ✅ were observed against a real daemon
> (upstream `daemon/`, Node 22, `CLAUDE_THING_MOCK=1`, WSL2). The envelopes, the handshake,
> every request/response below, and the SessionSummary field list are now **captured traffic,
> not transcription**. Values are mock; *shapes* are produced by the real `hub.js`/`store.js`
> code paths. Rows still unmarked remain unverified.

## Transport framing

JSON envelopes — ✅ all four confirmed exactly as written:

```json
{"type":"request","id":"<uuid>","method":"<method>","params":{}}
{"type":"response","id":"<uuid>","result":{}}
{"type":"error","id":"<uuid>","error":"<string>"}
{"type":"event","topic":"<topic>","data":{},"server_timestamp_ms":0}
```

⚠ **`type:"request"` is mandatory and its absence is silent.** `hub.js:42` drops any frame
that lacks `type:"request"` or a string `method` — no response, no error, no log. A client
sending bare `{id,method,params}` (the obvious JSON-RPC shape) gets *only* pushed events
and looks like a dead request path. Cost this session: one wrong-envelope capture round.

⚠ **The first frame must be `bridge.hello`.** Not optional decoration — it sets the socket's
role, which `/status` reports and `bridge.clients` broadcasts. Skipping it still answers
`claude.*` calls but leaves the client logged as role `unknown`.

**Their chain:** device app ⇄ `nocturned :5000` ⇄ daemon `ws://127.0.0.1:8790/ws`

**Our chain — ✅ PROVEN END-TO-END (2026-08-01):** device ⇄ `adb reverse tcp:8790 tcp:8790`
⇄ Windows `localhost:8790` ⇄ (mirrored networking) ⇄ daemon `ws://127.0.0.1:8790/ws`.

Verified **from the device itself**, not inferred:
- `wget`, `curl` and raw `nc` all fetched `/status` → `{"daemonVersion":"0.1.0",...}`
- A hand-rolled WebSocket handshake to `/ws` returned `HTTP/1.1 101 Switching Protocols`
  with a valid `Sec-WebSocket-Accept`, and the daemon **pushed a real
  `claude.sessions.update` frame to the device** on connect.

The device image ships `wget`, `curl`, `nc`, `telnet` and `busybox` — ample for probing.

⚠ `adb reverse --list` returns `protocol fault (couldn't read status length)` against this
device's 2020-era adbd. **Ignore it** — the tunnel works regardless; `reverse` returning
silently is success. Test the tunnel by fetching through it, never by `--list`.

✅ **The WSL2 leg of that chain is no longer a risk.** The daemon binds `127.0.0.1` only
(`config.js:12`, not configurable by env), and ADB runs on the Windows side — so a NAT-mode
WSL2 would have put the daemon out of ADB's reach. This box runs `networkingMode=mirrored`
(`C:\Users\YOURUSER\.wslconfig`), which shares the localhost stack; **verified from Windows
PowerShell reaching the WSL-bound daemon at `http://127.0.0.1:8790/status`.** If that config
ever reverts to NAT, this transport breaks and the daemon must move to Windows-side Node.

## Requests (device → daemon)

| Method | Params | Result |
|---|---|---|
| ✅ `bridge.hello` | `{role, info?}` | `{ok:true, daemonVersion}` — **send first** |
| `bridge.status` | connector status blob | `{ok:true}` — relay-only; echoes to `bridge.connector` |
| ✅ `claude.ping` | `{}` | `{daemonVersion, sessions:<count>}` |
| ✅ `claude.sessions.list` | `{limit?}` | `{sessions:[SessionSummary], stats, serverNowMs, tzOffsetMin}` |
| `claude.session.get` | `{id}` | SessionDetail, or "unknown session" error |
| `claude.permission.answer` | `{requestId, decision:"allow"\|"deny"}` | `{accepted:bool}` |
| ✅ `claude.queue.list` | `{}` | `{asks:[Ask]}` |
| `claude.question.answer` | `{id, optionIndex}` | acceptance status, keyboard delivery method |
| `claude.session.focus` | `{id}` | `{focused, app?, exact?, reason?}` |
| ✅ `claude.usage.get` | `{}` | Usage — **returned `{stale:true, error:"could not parse /usage output"}` on this box** |

✅ Unknown methods return `{type:"error", id, error:"Unknown method"}`.

⚠ **`claude.usage.get` does not work here yet.** It shells to `claude -p "/usage"` and parses
stdout; on this box that parse failed, so the usage screen has no data source until the
parser is adapted. Independent of the device — reproduce and fix host-side.

## Events (daemon → device)

| Topic | Data | Notes |
|---|---|---|
| ✅ `claude.sessions.update` | full sessions snapshot | debounced 500 ms; carries serverNowMs + tzOffsetMin. **Pushed unprompted on connect** — before any request |
| ✅ `claude.session.update` | SessionDetail | on change, live sessions only |
| `claude.permission.request` | requestId, sessionId, tool, summary, createdTs, timeoutMs | ⚠ `timeoutMs = 595000`, **not 55000** — see below |
| `bridge.clients` | `{<role>:<count>}` | roles online; fires on every connect/disconnect |
| `bridge.connector` | last `bridge.status` payload | relay-only |
| `claude.permission.resolved` | requestId, resolution | closes the prompt everywhere |
| `claude.question.request` | Ask (kind:question) | multiple-choice |
| `claude.question.resolved` | id, resolution | question dismissed |
| `claude.usage.update` | Usage | pushed once a minute |
| `claude.daemon.status` | `{connected:bool}` | relay-synthesised only |

## Shapes

- ✅ **SessionSummary** — `id, name, state("busy"|"attention"|"celebrate"|"idle"), lastActivityTs,
  tokens{in,out}, pendingPermission, ended, context(0..1|null)`, **+ `permissionMode`**
  (`"default"|"plan"|"bypassPermissions"|null`) — undocumented upstream, all four states observed
- ✅ **Stats** — `{active, attention}` (counts, not the richer blob the name suggests)
- **SessionDetail** — SessionSummary + `contextTokens, cwd, model, startedTs, currentTool,
  lastMessage(≤200 chars), permission`
- ✅ **Ask** — `{kind:"permission", id, sessionId, sessionName, tool, summary, createdTs, timeoutMs}`;
  question variant carries `options` instead of `tool`
- **Usage** — `updatedTs, limits[], windows[]` with request/session counts and
  skill / subagent / MCP breakdowns

### ⚠ Correction: the permission timeout is 595 s, not 55 s

Upstream's own `protocol/claude-protocol.md:57` says `timeoutMs = 55000`. **That is stale.**
`config.js:34` sets `PERMISSION_HOLD_MS = 595_000` and the observed Ask carried
`timeoutMs: 595000`. The 10-minute hold is deliberate — `HOOK_TIMEOUT_S = 600` must exceed it,
or Claude Code gives up first and the device answers into a closed connection.

A device UI that renders a 55 s countdown against a 595 s hold expires the prompt ~10× early
and looks broken while the session is still genuinely waiting. **Take the figure from the
`timeoutMs` on each Ask, not from a constant** — it is carried per-request for this reason.

## Why this beats what WigiDash has today

`WigiDash_Scripts/ClaudeCodeWidgets/Core/CacheReader.cs:12` polls
`\\wsl$\Ubuntu\dev\shm\claude_statusline.json` and parses three things — context usage and
MCP server health — on a 2 s debounce (`Integration/IntegrationManager.cs`).

This protocol gives **multi-session state, per-session `currentTool` and `lastMessage`,
and usage windows broken down by skill/subagent/MCP** — pushed rather than polled.

**The real prize is bidirectional.** `claude.permission.answer` and `claude.question.answer`
mean the device *answers* prompts. Every WigiDash widget built so far is read-only
monitoring (ControlPanel fires canned commands but never closes the loop on Claude's own
prompts). Once the daemon runs, that capability is available to **both** screens.

⚠ Caveat: `claude.question.answer` requires terminal focus + synthetic key typing. On Mac
that's Accessibility APIs; no Windows equivalent ships. Expect to write that path.
`claude.permission.answer` looks daemon-direct and should port cleanly.
