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

## ✅ VERIFIED wire format (captured on hardware 2026-08-15)

Both layers agree, the same discipline that produced the button table.

**Layer 1 — kernel capability bitmap** (`cat /proc/bus/input/devices`):
```
N: Name="rotary@0"
H: Handlers=event1          ← no kbd: Chromium can never see it
B: EV=5                     ← EV_SYN|EV_REL  (bit0|bit2). NO EV_KEY.
B: REL=40                   ← 0x40 = bit 6 = REL_HWHEEL
```

**Layer 2 — a real two-direction rotation** (40 events / 20 detents, 16-byte `input_event`
records, 32-bit `time_t`, little-endian):
```
ff 91 a4 54 | a9 23 0f 00 | 02 00 | 06 00 | 01 00 00 00
tv_sec      | tv_usec     | type  | code  | value
                            EV_REL  REL_HWHEEL  +1
00 92 a4 54 | 96 7e 02 00 | 00 00 | 00 00 | 00 00 00 00   ← EV_SYN terminator
```

**The decoder spec, therefore:**
- Read 16-byte records from `/dev/input/event1`.
- Act only on `type == 2` (`EV_REL`) **and** `code == 6` (`REL_HWHEEL`); ignore the `EV_SYN`.
- `value` is **always exactly ±1** — never 2, never accumulated (`ff ff ff ff` = −1, two's
  complement). **One detent = one event.** No tick summing is needed; a debounce is optional
  and only for fast spins, not for correctness.
- Observed cadence: 80–250 ms between detents at human turning speed, no bursts.

⚠ **Direction sign is probable, not proven.** The capture opened with `+1` while the owner was
asked to turn clockwise first, so `+1` = clockwise / `−1` = counter-clockwise. The turn was
back-and-forth and nobody watched the hand, so treat the sign as an integration-time detail to
confirm on first use — it is a one-character fix, not a redesign.

Suggested mapping: `+1` → `ArrowDown` (cursor forward), `−1` → `ArrowUp`.

## Field notes (cost real time — don't re-pay)

- 🔴 **Never background the reader inside `adb shell`.** `(timeout N dd ... &)` dies the moment
  the `adb shell` command returns — the PTY session ends and the orphan takes SIGHUP. It leaves
  a 0-byte file, which reads exactly like "the dial emits nothing." Keep the reader in the
  FOREGROUND (or hold the shell open with `wait`).
- 🔴 **Don't let a buffered writer be killed by `timeout`.** `timeout N hexdump -C /dev/input/eventN`
  loses everything: hexdump buffers ~4KB, a handful of 16-byte events never fills it, and SIGTERM
  discards the buffer unflushed. Prefer `dd ... of=<file> bs=16 count=N` so it exits on its own
  and the bytes are already on disk.
- **Always capture a control.** Recording `event0` (buttons) alongside `event1` is what
  distinguishes "the dial is silent" from "my capture is broken" — both empty means the tooling
  is at fault. That control is the only reason this was diagnosed instead of mis-reported.
- The device's `/tmp` does not survive a reboot — decode in the same invocation that captures.
- Expect to lose ADB mid-session (documented intermittent USB dropoff) — work in short bursts and
  prefer one combined `reverse && push && shell` invocation over three that each lose the window.
