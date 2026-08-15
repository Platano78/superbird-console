# superbird-console

A discontinued **Spotify Car Thing** turned into a physical console for **Claude Code** and a
local LLM fleet. It answers Claude's permission prompts from a hardware button, shows what every
session is doing, and switches which models a GPU box is serving — from a dial and five buttons,
without touching a keyboard.

Runs on **stock firmware**. No firmware fork, no reflash, no Bluetooth.

```
┌──────────────────────────────────────────────────┐
│ ① SESSIONS  ② FLEET  ③ MB  ④ CONTROL             │
│                                                  │
│  SEATS   LEAVES   AUX   THERM   COMPOSE          │
│                                                  │
│  CHAT                    GEMMA-4-26B ON :8081    │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ WORKER ·8081 │  │ SENIOR ·8080 │              │
│  │ GEMMA-4-26…  │  │ GPT-OSS-12…  │              │
│  └──────────────┘  └──────────────┘              │
└──────────────────────────────────────────────────┘
     dial: move · press: confirm · M: page
```

## What it does

- **Answers permission prompts.** When Claude Code asks to run a tool, the card appears on the
  device and a physical button allows or denies it. The prompt holds for ~10 minutes, so an
  agent working while you're across the room isn't silently blocked.
- **Shows every session** — state, tokens, context pressure, what tool is running, how long it's
  been waiting.
- **Drives a local LLM fleet.** Switch which models a serving box has loaded (its "leaves"),
  summon a large reviewer model onto the senior seat, start/stop an image-generation lane — each
  gated on a real completion, not an HTTP 200.
- **Signals with light.** The device has no speaker, so the backlight is the out-of-band channel:
  it pulses when a prompt is waiting and pulses differently when a fleet action failed.

## Hardware

An 800×480 touchscreen, a rotary dial (rotate + press), **five** buttons on the top row
(4 presets + M), and a Back button below the dial. That's it.

| Control | Does |
|---|---|
| Presets 1–4 | switch screens · **Allow** (1) / **Deny** (4) on a prompt |
| M (5th, top row) | page through the fleet view |
| Dial rotate | move the cursor |
| Dial press | confirm · **Allow** when a prompt is up |
| Back (below dial) | close a detail view |

⚠ **The dial's rotation is not visible to the browser.** The encoder has no `kbd` handler, so
Chromium never sees it — and the device ships no Node and no Python, so the textbook
evdev→uinput bridge has nothing to run in. `scripts/rotary-bridge.mjs` solves it host-side: a
bounded busybox loop decodes the event stream to text over `adb`, and the host injects arrow
keys via the Chrome DevTools Protocol. Details, including the verified wire format, are in
`docs/solutions/gotchas/`.

## Architecture

```
Car Thing (Chromium 69 kiosk, file://)
    │  adb reverse
    ├── :8790  claude-thing daemon ── Claude Code hooks (sessions, permissions)
    └── :8791  deviceinfo service  ── fleet state, actions, disk, queue
                    │
                    └── consumes a fleet-state document from a serving box
```

The device holds no credentials and reaches nothing on its own — every network call is a host
service over `adb reverse`. That's deliberate: it's a screen with buttons, not a client.

## Lineage, honestly

The spark was an [iFixit guide](https://www.ifixit.com/Guide/How+to+Install+Custom+Firmware+onto+Car+Thing/178814)
for installing custom firmware on the Car Thing.

The functional inspiration is **[`rithkott/claude-thing`](https://github.com/rithkott/claude-thing)**,
which first turned this device into a Claude Code monitor. The `claude.*` wire protocol here is
extracted from it and documented in `docs/claude-protocol.md`.

Credit where it's due: upstream already does sessions-at-a-glance, a queue of what's waiting,
usage bars, **and permission approve/deny from the dial**. Those ideas are theirs.

This is **not a fork of it**, and it diverges in two ways:

- **How it runs.** Upstream is a Nocturne *firmware fork* with a Swift Bluetooth relay, and is
  macOS-only. This runs on **stock firmware** over ADB with its own web app — no reflash, no
  Bluetooth, and it works from a Windows/WSL host.
- **What else it drives.** Beyond Claude, this controls a **local LLM fleet** — which models a
  serving box has loaded, summoning a large reviewer model, an image-generation lane, thermals —
  with each switch gated on a real generated completion rather than a health check.

Flashing was explored via **DeskThing** and **Terbium** (Thing Labs); DeskThing was ultimately
dropped as a runtime dependency entirely. See `docs/firmware-decision.md` for that decision and
the alternatives rejected along the way.

## Status

Working on real hardware. The fleet view, permission answering, backlight signalling, and the
rotary bridge are all verified on-device, not just in tests. Rough edges are recorded in
`docs/` rather than hidden — including several defects that passed every automated gate and were
only caught by looking at the panel.

## Getting started

You need the device on ADB and a Claude Code install. Start with:

- `docs/car-thing-builder-starter.md` — the from-scratch guide, written for someone who has one
  of these in a drawer. Covers flashing, the Chromium 69 constraints, and the physical controls.
- `docs/operations-runbook.md` — deploying a UI change, the services, the backlight, buttons.
- `AGENTS.md` — the map, if you're pointing an AI agent at this repo.

Configuration (device serial, adb path, fleet host) is via environment variables with working
defaults — see the Configuration section of the operations runbook.

## A note on the docs

They're unusually blunt about what went wrong: warnings carry the incident that produced them,
and rejected approaches say why they were rejected. That's intentional. Chromium 69 has traps
(flex `gap` silently renders as zero spacing; an ES-module asset import blank-screens the kiosk)
that cost real hardware time to find, and a warning without its incident tends to get
"cleaned up" by the next person.
