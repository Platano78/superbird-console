# car-thing — AGENTS.md (router / the map)

You are the generic agent. Reading this makes you the **car-thing** agent.
On entry: read this map → route to the area for the task → load ONLY that area's Inputs.

## What this is

A discontinued **Spotify Car Thing** (superbird; 800×480 touchscreen, dial, 4 preset buttons)
turned into a **Claude Code monitoring + permission-answering surface**. Host is Windows 11 + WSL2.

**Working as of 2026-08-02.** The device runs our own web app from its own disk
(`device/`), connecting straight to the `claude-thing` daemon over `adb reverse`.
**DeskThing is NOT required** — dropped as a runtime dependency. Firmware stays
`8.9.2-thinglabs`, which is stock Spotify + ADB enabled; no reflash was ever needed. We keep
upstream's Node daemon + `claude.*` protocol and do NOT fork the firmware. Day-to-day operation
→ `docs/operations-runbook.md`.

## Areas (route by task — load Inputs, skip the rest)

| If the task is about… | Read (Inputs) | Skip |
|---|---|---|
| **Which firmware, why DeskThing, what we keep from upstream** | `docs/firmware-decision.md` | runbook, protocol |
| **Running it: services, hooks, deploying a UI change, reading the device screen, physical buttons, backlight** | `docs/operations-runbook.md` | flashing, firmware-decision |
| **Flashing, boot mode, drivers, USB not enumerating** | `docs/flashing-runbook.md` | firmware-decision, protocol |
| **Starting from scratch with one of these in a drawer** | `docs/car-thing-builder-starter.md` | firmware-decision, protocol |
| **Message contract, daemon endpoints, session/usage shapes** | `docs/claude-protocol.md` | flashing, firmware-decision |
| **`:8791` device-info state + actions (seats/leaves/aux, `mb.*`, DRYRUN)** | `docs/deviceinfo-protocol.md` | flashing, firmware-decision |
| **A bug or trap you're re-hitting** | `docs/solutions/` (by category, YAML frontmatter) | runbooks, firmware-decision |

## Naming conventions (locate files, don't grep blindly)
- `docs/firmware-decision.md` = ratified calls + rejected alternatives. Amend, never silently reverse.
- `docs/*-runbook.md` = ordered procedures meant to be executed, not summarised.
- `docs/claude-protocol.md` = transcribed from upstream docs, **not** captured traffic — treat
  every table as unverified until real messages have been observed.
- External repos (`claude-thing`, `DeskThing`, thingify/terbium) are **not vendored**. Fetch, don't grep.

## Laws
- **Never run `claude-thing`'s `./mac/install.sh`** — it rewrites `~/.claude/settings.json`.
  Extract hook definitions by hand; this project's `scripts/install-hooks-by-hand.mjs` does it
  without touching the rest of your config.
- **Verify on the device, not at the gate.** Several defects here passed the build, the type
  check and code review, and were caught only by looking at the panel. If you claim something
  works on hardware, prove it with a screenshot or a log read from the device.

## Fallback law
Task not on this map → ask which area, or stay here. **Never wander the tree** or bulk-read
root docs.
