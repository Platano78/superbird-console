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

while true; do
  if "$ADB" devices 2>/dev/null | grep -q "device$"; then
    # `adb reverse --list` throws "protocol fault" against this device's
    # 2020-era adbd, so it cannot be used as the health check. Re-asserting the
    # tunnel is idempotent and cheap, so just do that.
    "$ADB" reverse tcp:8790 tcp:8790 >/dev/null 2>&1
    "$ADB" forward tcp:9222 tcp:2222 >/dev/null 2>&1   # device DevTools console
  fi
  sleep "$INTERVAL"
done
