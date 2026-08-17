# Changelog

All notable changes to this project are documented here.

## [0.5.0] - 2026-08-16

### Changed
- **`QUEUE_ROOT` and `OBLIGATIONS_SCRIPT` are now plain optional config vars**, not paths
  derived from the service's own location. The derivation looked layout-independent but was
  not: it hardcoded one workspace's sibling *directory names*, so the path could only ever
  resolve for its author and silently missed for everyone else. Unset now means unconfigured —
  every count reports `null` with a reason rather than a fabricated `0`, matching how
  `MB_HOST`/`CODER_HOST` already behave. Neither block is rendered by the device app today, so
  leaving both unset costs nothing; set them in `superbird.conf` to restore the old behaviour.

### Fixed
- **`superbird.conf.example` told you to copy it to the wrong filename.** Its header still
  described an abandoned plan — rename the template before publishing, copy it to a dotenv
  file — so anyone following it would create a config nothing loads. The config is
  `superbird.conf`, as `.gitignore`, `INSTALL.md` and `setup.sh` all already said. `setup.sh`
  carried the same stale "once renamed" note.

## [0.4.0] - 2026-08-16

### Added
- **A `CHANNELING` indicator on the fleet view** — a fuchsia micro-line that lights on a seat
  only while it is actively generating a completion, with a slot count when the seat has more
  than one slot (e.g. `CHANNELING 1/4`). Before this, a seat marked `serving` looked identical
  whether the model was parked or thirty seconds into a long completion — the only thing moving
  on screen proved the *monitor* was alive, not the model. The underlying `busy` field is
  three-valued: generating, idle, or unknown (some inference servers don't expose per-slot
  status). Unknown and idle render identically — nothing at all — because an idle light on a
  busy seat would be a silent lie that nobody would notice, unlike a wrong status pill. A stale
  reading renders nothing too, since a stale "busy" is only a claim about the past.

### Fixed
- 🔴 **A CONTROL tile could not light for the model that was actually loaded.** The router
  renamed a preset and `buttons.json` still carried the old id, so the tile matched nothing —
  while the status line above it printed the router's own string correctly, which is what made
  it look like a rendering bug rather than a config one. The id is corrected, and the grid now
  uses the roster the service was already sending: a tile naming a preset the router does not
  have renders as `NO PRESET` and is inert, instead of looking exactly like a live model that
  simply is not running. Matching stays exact — a fuzzy match would light the wrong tile, which
  is worse than lighting none.

## [0.3.0] - 2026-08-16

### Added
- **COMPOSE (Phase D)** — launch an operator-chosen combination of models on the fleet host,
  outside the fixed leaf roster. The page lists the host's own model roster (class, context,
  whether the file is present), assigns ports to a selection, and offers DRYRUN / LAUNCH / STOP.
  A refusal (the launcher declined, nothing started) and a gate failure (something started and
  never came up) are rendered as different facts in different colours.
  The page is touch-driven; dial/cursor navigation is not wired yet.
- The device-info service gained a `compose` block in `/state` (host roster, cached rather than
  polled) and an `mb.compose.*` action family.

### Fixed
- 🔴 **Fleet-view actions never actually ran.** The `mb.*` two-step confirm was added
  server-side in v0.2.0 — POST #1 returns a single-use token and executes nothing, POST #2 runs
  it — but the device only ever sent POST #1. Every leaf flip, herald summon and pcreate toggle
  fired from the fleet view was a silent no-op, while the tile latched to "committed" and looked
  like it had worked. `fireAction` now completes both posts.

### Security
- `mb.compose.*` is the only action family whose command is parameterised by device input, so it
  cannot use the fixed allowlist that protects the others. Every selection is validated against
  the roster the **host itself** reported: model keys must exist there and be present, ports come
  from a literal set, context must fit that model's maximum, plus a charset assertion on each key.
  Anything failing is refused before ssh is spawned.

## [0.2.0] - 2026-08-16

First public release. The project existed privately before this; the version reflects the
device app's own history rather than starting over at 0.1.0.

### Added
- **Permission answering from hardware.** Claude Code's permission prompts render on the device
  and are answered with a physical button or the dial. The hold is 30 s, so an unanswered prompt
  falls through to the terminal instead of stalling it.
- **Session view** — per-session context pressure, state, tokens in/out, and what is waiting.
- **Fleet control** — switch which models a serving box has loaded, summon a reviewer model onto
  the senior seat, drive an image-generation lane. Each switch is gated on a real generated
  completion, not an HTTP 200.
- **Backlight as an out-of-band channel.** The device has no speaker; it pulses when a prompt is
  waiting and pulses differently when a fleet action failed.
- **Host-side rotary bridge** (`scripts/rotary-bridge.mjs`). The dial's rotation is invisible to
  Chromium and the device ships no Node or Python, so a bounded busybox loop decodes the event
  stream over `adb` and the host injects arrow keys over CDP. It may dispatch only
  `ArrowUp`/`ArrowDown` — a bridge bug must never be able to synthesise a tool-call approval.
- **Demo mode** (`?demo=1`) with fictional fixtures, so the app is explorable with no device and
  no fleet. A configured-but-currently-down fleet deliberately does *not* become demo data.
- **Seat-occupancy fallback** when the fleet aggregator is unreachable — occupancy only, never
  inferred model/profile names, and it says it is degraded.
- `scripts/setup.sh` — one entry point from fresh checkout to running services. Never prompts, so
  it is safe to drive unattended; `--dry-run` previews and changes nothing.

### Fixed
- Systemd units no longer hardcode one machine's repo path or an exact nvm Node build. They are
  templates now, filled in at install time, and `setup.sh` refuses to install a unit with an
  unfilled placeholder.
- The operations runbook documented a `car-thing-adb.service` that ships nowhere, titled a
  three-row table "the two services", and omitted two units that do ship.
- The by-hand hook installer is at `scripts/install-hooks-by-hand.mjs`; docs pointed at its old
  scratchpad path.

### Notes
- Runs on **stock firmware** (`8.9.2-thinglabs` = stock Spotify + ADB). No reflash, no firmware
  fork, no Bluetooth. Works from a Windows/WSL host.
- The device holds no credentials and reaches nothing on its own — every network call is a host
  service over `adb reverse`, and those services bind loopback only.
- Lineage is credited in the README: the functional inspiration is
  [`rithkott/claude-thing`](https://github.com/rithkott/claude-thing), and the `claude.*` wire
  protocol here is extracted from it.
