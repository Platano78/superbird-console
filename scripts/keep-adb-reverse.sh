#!/bin/sh
# Keep `adb reverse tcp:8790 tcp:8790` alive for the Car Thing.
#
# The tunnel is per-connection: it dies every time the device re-enumerates,
# and this device drops off USB regularly. Without it the kiosk app shows
# "offline" until someone re-runs adb by hand.
#
# ADB must be the WINDOWS one — the device is on the Windows USB bus and WSL2
# has none. Never start a second adb server in WSL: mirrored networking makes
# both bind the same 127.0.0.1:5037 and they fight (device lists, then
# "no devices/emulators found").

# CAR_THING_ADB defaults to plain 'adb' on PATH -- fine on Linux. A WSL host
# needs the Windows adb.exe path instead; scripts/setup.sh auto-detects it.
ADB="${CAR_THING_ADB:-adb}"
INTERVAL="${INTERVAL:-30}"

# ⚠ ALWAYS address the Car Thing by serial once more than one device can ever
# be attached. A bare `adb reverse` aborts with "error: more than one
# device/emulator" the instant a second device joins the adb server — a phone
# on wireless debugging is enough. That happened on 2026-08-02: a second phone
# joined the adb server, every re-assert here failed silently (stderr was
# already redirected to /dev/null), the tunnel lapsed and the device dropped
# off the daemon entirely (`clients` lost "car-thing").
# CAR_THING_SERIAL is unset by default -- fine for the common single-device
# case (below falls back to matching ANY attached device). Set it once a
# second device is ever attached; scripts/setup.sh auto-detects it too.
SERIAL="${CAR_THING_SERIAL:-}"

# Runs adb with -s "$SERIAL" when a serial is set, plain otherwise -- POSIX
# sh has no arrays, so this is the portable way to make the flag conditional.
adb_run() {
  if [ -n "$SERIAL" ]; then "$ADB" -s "$SERIAL" "$@"; else "$ADB" "$@"; fi
}

while true; do
  # With a serial set, match it specifically — a bare "device$" match would
  # also be satisfied by some OTHER device being online while the Car Thing
  # itself is absent. No `$` anchor: adb.exe is a Windows binary and its
  # output lines end with a stray CR, so "device$" is at the mercy of how the
  # local grep treats it. Without a serial, fall back to "is anything online".
  MATCH_PATTERN="${SERIAL:-^[^[:space:]]\+}[[:space:]].*device"
  if "$ADB" devices 2>/dev/null | grep -q "$MATCH_PATTERN"; then
    # `adb reverse --list` throws "protocol fault" against this device's
    # 2020-era adbd, so it cannot be used as the health check. Re-asserting the
    # tunnel is idempotent and cheap, so just do that.
    adb_run reverse tcp:8790 tcp:8790 >/dev/null 2>&1
    adb_run reverse tcp:8791 tcp:8791 >/dev/null 2>&1   # deviceinfo (fleet/queue/disk)
    adb_run forward tcp:9222 tcp:2222 >/dev/null 2>&1   # device DevTools console
  fi
  sleep "$INTERVAL"
done
