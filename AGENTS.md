# car-thing — AGENTS.md (router / the map)

You are the generic agent. Reading this makes you the **car-thing** agent.
On entry: read this map → route to the area for the task → load ONLY that area's Inputs.

## What this is

A discontinued **Spotify Car Thing** (superbird; 800×480 touchscreen, dial, 4 preset buttons)
turned into a **Claude Code monitoring + permission-answering surface**. Firmware base is
**DeskThing**; host is Windows 11 + WSL2. The one thing that matters most: the upstream
`claude-thing` project is Mac-only, so we keep its Node daemon + `claude.*` protocol and
rebuild the device UI as a DeskThing app — we do NOT fork the firmware.

## Areas (route by task — load Inputs, skip the rest)

| If the task is about… | Read (Inputs) | Skip |
|---|---|---|
| **Where we are / what's next / blocked** | the internal status doc | the three reference docs |
| **Which firmware, why DeskThing, what we keep from upstream** | `docs/firmware-decision.md` | runbook, protocol, status |
| **Flashing, boot mode, drivers, USB not enumerating** | `docs/flashing-runbook.md` | firmware-decision, protocol |
| **Message contract, daemon endpoints, session/usage shapes** | `docs/claude-protocol.md` | flashing, firmware-decision |
| **What ports from/to WigiDash** | `docs/claude-protocol.md` §"Why this beats…", then `../WigiDash_Scripts/AGENTS.md` | flashing, firmware-decision |
| **Session pickup / handoff** | `_pickup-handoff.md` | everything else |

## Verbs
- `pickup`  → read `_pickup-handoff.md` §pickup, then route to the named area.
- `handoff` → read `_pickup-handoff.md` §handoff.

## Naming conventions (locate files, don't grep blindly)
- the internal status doc + `docs/_next-session-prompt.md` = the two regenerated-per-session files
  (`_next-*` is overwritten by each handoff, never appended). Everything else in `docs/` is
  reference — stable, cite it, don't rewrite it per session.
- `docs/firmware-decision.md` = ratified calls + rejected alternatives. Amend, never silently reverse.
- `docs/*-runbook.md` = ordered procedures meant to be executed, not summarised.
- `docs/claude-protocol.md` = transcribed from upstream docs, **not** captured traffic — treat
  every table as unverified until real messages have been observed.
- External repos (`claude-thing`, `DeskThing`, thingify/terbium) are **not vendored**. Fetch, don't grep.

## Laws
- **Never run `claude-thing`'s `./mac/install.sh`** — it rewrites `~/.claude/settings.json`.
  Extract hook definitions by hand; this box has a hand-tuned hook config.

## Fallback law
Task not on this map → ask which area, or stay here. **Never wander the tree** or bulk-read
root docs. If this project is the wrong home → return to `../AGENTS.md` (workspace root).
