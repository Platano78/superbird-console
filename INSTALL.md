# Installing superbird-console

Written so an agent (or a human) can follow it without judgment calls: numbered steps, exact
commands, and what to expect at each one. See the end for a step-by-step verification checklist.

## Prerequisites

- **Hardware, for the device parts:** a Spotify Car Thing on stock firmware, reachable over adb
  (USB). See `docs/car-thing-builder-starter.md` for flashing/bring-up if you're starting from a
  blank device.
- **Software:** Node.js ≥ 22 (global `fetch`/`WebSocket`, zero npm dependencies), `adb`
  (Android platform-tools), `bash`, `systemd --user` (this repo's services run as user units).
- **Claude Code** installed and on PATH, for the permission-answering half.

### What works WITHOUT a Car Thing or a fleet box

The `services/deviceinfo` server and `scripts/setup.sh` both run fine with no device attached
and no local LLM fleet configured — device-derived fields report `unavailable`/`configured:
false` instead of erroring, and the fleet screens report themselves unconfigured (see
`docs/operations-runbook.md`'s Configuration section). You only need the physical device to see
any of it rendered on real hardware.

## 1. Clone and enter the repo

```bash
git clone <this-repo-url> car-thing
cd car-thing
```
Expected: a `car-thing/` directory containing this file.

## 2. Run setup

```bash
bash scripts/setup.sh
```
Expected output: lines showing the detected `adb` binary and device serial, a line confirming
`superbird.conf` was written (or already exists — setup.sh never overwrites one), one `installed ...`
line per systemd unit, an `enabled: ...` line, then a `Next steps:` block.

**Detection failures** (no adb, no device, more than one device) print a message starting
`[setup] ERROR:` and exit non-zero — the message says exactly what to do (install adb, plug in
the device, or set `CAR_THING_SERIAL`/`CAR_THING_ADB` yourself in `superbird.conf`).

**Running this as an agent** (no human to watch the ambiguous case): pass `--non-interactive` —
identical detection, but it never blocks on input; every failure is a message + non-zero exit.

**Previewing without changing anything:**
```bash
bash scripts/setup.sh --dry-run
```
Expected: the same detection output, prefixed `--dry-run:` on every line that would otherwise
write or install something, ending `--dry-run: nothing was changed.` `git status --porcelain`
is identical before and after.

## 3. (Optional) turn on the local LLM fleet screens

Only if you have a separate box running a local model server. Edit `superbird.conf` (the file
`scripts/setup.sh` wrote) and uncomment/fill in:

```
MB_HOST=<your fleet box's LAN host or IP>
MB_SSH_HOST=<an alias from your own ~/.ssh/config for that box>
CODER_HOST=<host running a second always-on model, if you have one>
```
See `superbird.conf.example` for what each one does and the exact contract. Leave them commented/unset to
skip this — the Claude-monitoring half of this project needs none of them.

## 4. Restart the services to pick up `superbird.conf`

```bash
systemctl --user restart car-thing-deviceinfo.service car-thing-backlight.service car-thing-rotary.service
```
Expected: no output (systemd is silent on success).

## 5. Install the Claude Code hooks (permission answering)

```bash
node scripts/install-hooks-by-hand.mjs
```
Expected: a `backup: ...` line followed by one `<EventName>: <before> -> <after>` line per hook
event (all `after` counts one higher than `before`). This only APPENDS to
`~/.claude/settings.json` and refuses to run (exit 1, no changes) if anything existing would be
lost. Hooks apply to sessions started **after** this runs.

## Verify it worked

1. **The service is up:**
   ```bash
   systemctl --user is-active car-thing-deviceinfo.service
   # expect: active
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8791/state
   # expect: 200
   ```
2. **The state payload is honest.** Without a fleet box configured:
   ```bash
   curl -s http://127.0.0.1:8791/state | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['fleet']['coder'])"
   # expect: {'reachable': False, 'configured': False} -- NOT an error, NOT a probe timeout
   ```
   With one configured (step 3), `configured` is `True` and `reachable` reflects whether it
   actually answered.
3. **The device sees the daemon**, if you have hardware attached:
   ```bash
   curl -s --max-time 45 -X POST http://127.0.0.1:8790/hook \
     -H 'Content-Type: application/json' \
     -d '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo TEST"}}'
   ```
   Expected: a card appears on the device; answering it returns `{"decision":{"behavior":"allow"}}`
   or `{"decision":{"behavior":"deny"}}` to this curl call.
4. **Re-running setup is a no-op:**
   ```bash
   bash scripts/setup.sh
   # expect: the ".env already exists -- leaving it untouched" line, no other file changes
   ```

## Troubleshooting

- **`EADDRINUSE` on :8791 or :8790** — something is already listening (a stray manual run of
  `node services/deviceinfo/server.js`, most likely). `systemctl --user status
  car-thing-deviceinfo.service` and kill whatever else is bound before restarting.
- **`no adb found`** — install Android platform-tools; on WSL2, `adb` on the Linux side cannot
  see the device (it's on the Windows USB bus) — you need the Windows `adb.exe`'s path in
  `CAR_THING_ADB`.
- **More than one device attached** — `scripts/setup.sh` refuses to guess; unplug the others or
  set `CAR_THING_SERIAL` in `superbird.conf` yourself.
- Everything else operational (deploying a UI change, the backlight channel, physical button
  mapping, reading the device screen over CDP): `docs/operations-runbook.md`.
