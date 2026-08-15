---
title: "The rotary dial is unreadable from the web app, and the evdev bridge cannot live on the device"
date: "2026-08-15"
track: constraint
problem_type: gotcha
category: gotchas
tags: ["car-thing", "superbird", "rotary", "evdev", "uinput", "input", "chromium-69", "kiosk", "adb", "cdp", "hardware-limits", "device-rootfs"]
module: "car-thing/device + scripts"
component: "physical controls / rotary@0"
root_cause: "The rotary encoder's kernel device exposes no `kbd` handler, so Chromium never receives rotation events; and the device rootfs ships no Node and no Python, so the obvious fix (a device-resident evdev→uinput bridge) has no runtime to run in."
resolution_type: "design_constraint"
symptoms: ["Turning the dial produces no keydown event and no window.__klog entry, while every button does", "Only the dial PRESS registers (as Enter)", "A plan to 'just add a uinput bridge' stalls when nothing on the device can execute it"]
---

## Problem

The owner's design thesis for the fleet view was "use the dial + M button for paging so the
touchscreen keeps its area." The M button works. **The dial's rotation cannot be read by the
web app at all**, and the standard fix does not fit this device.

## The two facts

**1. Rotation never reaches Chromium.** The buttons work because `gpio-keys` is `kbd`-handled,
so Chromium receives them as ordinary `keydown` events on `window`. The rotary is a different
device: `rotary@0` reports `Handlers=event1` with **no `kbd`**. Nothing translates it into a
key event, so there is no listener, polyfill, or JS-side trick that can see it — this is not
an app bug to fix. Independently documented in `docs/operations-runbook.md` §Physical controls
and `docs/car-thing-builder-starter.md` §7 ("there is no way to read it from the web app alone").

Only the dial **press** comes through, as `Enter`.

**2. 🔴 The bridge cannot be device-resident — there is no runtime for it.** The obvious
answer ("write an evdev→uinput bridge") assumes something on the device can run it. It cannot:

- The image ships **`wget`, `curl`, `nc`, `telnet`, `busybox`** and that is the documented list
  (`docs/claude-protocol.md`). **No Node. No Python.** A `rotary-bridge.mjs` or `.py` pushed to
  the device has nothing to execute it.
- A cross-compiled ARM binary would be this project's first native build, first rootfs remount
  for a *service*, and first new `supervisord.conf` program entry — the device is supervised by
  **`supervisord`, not systemd**, and `supervisorctl` is the only correct lever (a `SIGKILL`
  gets the process respawned instantly).
- Raw event bytes cannot be piped over `adb shell`: `adb shell -T` (no-PTY) **fails** on this
  device ("device only supports allocating a pty"), so every shell gets a PTY that echoes stdin
  on stdout, and a persistent stdin-fed shell eventually deadlocks on an undrained pipe
  (`scripts/backlight-daemon.mjs` header). **Decode to text device-side; never stream binary.**

## The shape that does fit

Host-side, reusing two transports this project has already proven:

1. A **bounded, self-terminating busybox loop** on the device decodes `/dev/input/eventN` to
   **one line of text per event**, respawned by the host before it expires.
2. A **host-side Node service** reads those lines and injects `ArrowUp`/`ArrowDown` into the
   kiosk via **CDP `Input.dispatchKeyEvent`** on the already-open `--remote-debugging-port=2222`
   (`adb forward tcp:9222 tcp:2222`).

This is the same idiom as `scripts/backlight-daemon.mjs`, which drives the device over
`adb shell` from the host and already spawns bounded device-side loops. It adds **zero**
device-resident artifacts. ADB must be the **Windows** binary addressed **by serial** — a bare
`adb shell` fails outright.

⚠ Dial navigation then depends on the host adb link. That is not a new dependency class: the
daemon (`:8790`) and deviceinfo (`:8791`) tunnels the app already runs on have the same
dependency. But it does mean **the UI must stay fully usable without the dial** — see
the internal fleet-view spec Ruling 9 (touch parity) and Ruling 4 (input-agnostic
nav hook).

**Containment law:** the bridge must dispatch **only** `ArrowUp`/`ArrowDown` — never `Enter`,
never the digits. Those answer permission prompts, and a bridge bug must never be able to
synthesise a permission answer on a device that grants tool calls.

## Still unverified (needs the device on the USB bus)

The rotary's **capability bitmap** — whether rotation is `EV_REL` (relative ticks) or `EV_KEY`
(discrete detent keycodes) — and its `eventN` under the current boot. Only `Handlers=event1` /
no-`kbd` is on the record. **Read a real two-direction rotation, not just the bitmap**: the
button table was earned by agreeing two independent layers (kernel capability bitmap + a real
press captured at both evdev and DOM level), and the decoder's shape depends on that answer.

Expect to lose ADB mid-session (documented intermittent USB dropoff) — work in short bursts and
prefer one combined `reverse && push && shell` invocation over three that each lose the window.
