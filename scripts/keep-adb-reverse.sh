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

ADB='/mnt/c/Users/YOURUSER/AppData/Local/Programs/deskthing/resources/win/adb.exe'
INTERVAL="${INTERVAL:-30}"

# ⚠ ALWAYS address the Car Thing by serial. A bare `adb reverse` aborts with
# "error: more than one device/emulator" as soon as ANY second device is
# attached — a phone on wireless debugging is enough. That happened on
# 2026-08-02: a OnePlus joined the adb server, every re-assert here failed
# silently (stderr was already redirected to /dev/null), the tunnel lapsed and
# the device dropped off the daemon entirely (`clients` lost "car-thing").
# Override with CAR_THING_SERIAL if the device is ever replaced.
SERIAL="${CAR_THING_SERIAL:-DEVICESERIAL}"

while true; do
  # Match the serial specifically — `grep -q "device$"` would also be satisfied
  # by some OTHER device being online while the Car Thing is absent.
  # No `$` anchor: adb.exe is a Windows binary and its output lines end with a
  # stray CR, so "device$" is at the mercy of how the local grep treats it.
  if "$ADB" devices 2>/dev/null | grep -q "^${SERIAL}[[:space:]].*device"; then
    # `adb reverse --list` throws "protocol fault" against this device's
    # 2020-era adbd, so it cannot be used as the health check. Re-asserting the
    # tunnel is idempotent and cheap, so just do that.
    "$ADB" -s "$SERIAL" reverse tcp:8790 tcp:8790 >/dev/null 2>&1
    "$ADB" -s "$SERIAL" reverse tcp:8791 tcp:8791 >/dev/null 2>&1   # deviceinfo (fleet/queue/disk)
    "$ADB" -s "$SERIAL" forward tcp:9222 tcp:2222 >/dev/null 2>&1   # device DevTools console
  fi
  sleep "$INTERVAL"
done
