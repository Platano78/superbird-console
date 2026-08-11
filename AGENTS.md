# car-thing — AGENTS.md (router / the map)

You are the generic agent. Reading this makes you the **car-thing** agent.
On entry: read this map → route to the area for the task → load ONLY that area's Inputs.

## What this is

A discontinued **Spotify Car Thing** (superbird; 800×480 touchscreen, dial, 4 preset buttons)
turned into a **Claude Code monitoring + permission-answering surface**. Host is Windows 11 + WSL2.

**Working as of 2026-08-02.** The device runs our own web app from its own disk
(`device/`), connecting straight to the `claude-thing` daemon over `adb reverse`.
**DeskThing is NOT required** — dropped as a runtime dependency (D-f18d6e0d, amending
D-7c50e23a). Firmware stays `8.9.2-thinglabs`, which is stock Spotify + ADB enabled; no
reflash was ever needed. We keep upstream's Node daemon + `claude.*` protocol and do NOT
fork the firmware. Day-to-day operation → `docs/operations-runbook.md`.

## Areas (route by task — load Inputs, skip the rest)

| If the task is about… | Read (Inputs) | Skip |
|---|---|---|
| **Where we are / what's next / blocked** | the internal status doc | the three reference docs |
| **Which firmware, why DeskThing, what we keep from upstream** | `docs/firmware-decision.md` | runbook, protocol, status |
| **Running it: services, hooks, deploying a UI change, reading the device screen, physical buttons, backlight** | `docs/operations-runbook.md` | flashing, firmware-decision |
| **Flashing, boot mode, drivers, USB not enumerating** | `docs/flashing-runbook.md` | firmware-decision, protocol |
| **Message contract, daemon endpoints, session/usage shapes** | `docs/claude-protocol.md` | flashing, firmware-decision |
| **What ports from/to WigiDash** | `docs/claude-protocol.md` §"Why this beats…", then `../WigiDash_Scripts/AGENTS.md` | flashing, firmware-decision |
| **A bug or trap you're re-hitting** | `docs/solutions/` (by category, YAML frontmatter) | runbooks, firmware-decision |
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
