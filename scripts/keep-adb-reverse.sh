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

# Network-attached devices that must share THIS adb server, space-separated
# host:port. The wall panel is one: it is a LAN device, so it joins
# the server with `adb connect` instead of by being plugged in.
#
# Re-asserting the connect here is what keeps ONE server serving both devices.
# On 2026-08-29 the wall panel had been connected by hand to a second, WSL-side
# adb server; under mirrored networking that server owned 5037, the Windows
# adb.exe demoted itself to a client of it, and the Car Thing's USB reached no
# server at all -- `clients` lost "car-thing" while every systemd unit stayed
# green. Owning the connect here means the shared server is rebuilt by this
# loop rather than by whoever last ran adb by hand.
#
# `adb connect` is idempotent: an already-connected device just re-reports
# itself, so this is safe to re-run every INTERVAL.
ADB_NET_DEVICES="${ADB_NET_DEVICES:-}"

# Runs adb with -s "$SERIAL" when a serial is set, plain otherwise -- POSIX
# sh has no arrays, so this is the portable way to make the flag conditional.
adb_run() {
  if [ -n "$SERIAL" ]; then "$ADB" -s "$SERIAL" "$@"; else "$ADB" "$@"; fi
}

# Log only on transitions. This loop runs every 30 s forever, so logging state
# unconditionally would bury the journal; logging nothing at all is what let
# the 2026-08-29 outage sit invisible behind a green unit for a day.
# Empty (not 0) so the very first pass logs whichever state it finds.
WAS_PRESENT=
FOREIGN_WARNED=

note() { echo "$(date '+%Y-%m-%d %H:%M:%S') keep-adb-reverse: $*" >&2; }

# The recurrence guard for the outage described above. If we are pointed at a
# Windows adb.exe but a Linux-side adb server holds 5037, that server has taken
# the port the Windows one needs and the USB device is unreachable no matter
# how healthy this unit looks. We only warn: killing another session's adb
# server from a 30 s background loop would be a cure worse than the disease.
check_foreign_server() {
  case "$ADB" in /mnt/[a-z]/*) ;; *) return 0 ;; esac
  if pgrep -f 'adb -L tcp:5037.*fork-server' >/dev/null 2>&1; then
    [ -n "$FOREIGN_WARNED" ] && return 0
    note "WARNING: a Linux-side adb server holds 5037 while CAR_THING_ADB is the Windows adb.exe;"
    note "WARNING: it cannot serve USB until that server goes. Fix: 'adb kill-server' in WSL, then '$ADB start-server'."
    FOREIGN_WARNED=1
  else
    FOREIGN_WARNED=
  fi
}

while true; do
  # With a serial set, match it specifically — a bare "device$" match would
  # also be satisfied by some OTHER device being online while the Car Thing
  # itself is absent. No `$` anchor: adb.exe is a Windows binary and its
  # output lines end with a stray CR, so "device$" is at the mercy of how the
  # local grep treats it. Without a serial, fall back to "is anything online".
  MATCH_PATTERN="${SERIAL:-^[^[:space:]]\+}[[:space:]].*device"

  check_foreign_server

  # Pull the LAN devices onto this same server before looking for the Car
  # Thing, so one server ends up holding both and either session can drive
  # either device.
  for netdev in $ADB_NET_DEVICES; do
    "$ADB" connect "$netdev" >/dev/null 2>&1
  done

  if "$ADB" devices 2>/dev/null | grep -q "$MATCH_PATTERN"; then
    [ "$WAS_PRESENT" = 1 ] || note "car-thing ${SERIAL:-(any device)} present; asserting tunnels"
    WAS_PRESENT=1
    # `adb reverse --list` throws "protocol fault" against this device's
    # 2020-era adbd, so it cannot be used as the health check. Re-asserting the
    # tunnel is idempotent and cheap, so just do that.
    adb_run reverse tcp:8790 tcp:8790 >/dev/null 2>&1
    adb_run reverse tcp:8791 tcp:8791 >/dev/null 2>&1   # deviceinfo (fleet/queue/disk)
    adb_run forward tcp:9222 tcp:2222 >/dev/null 2>&1   # device DevTools console
  else
    [ "$WAS_PRESENT" = 0 ] || note "car-thing ${SERIAL:-(any device)} NOT on the adb server; kiosk will read offline"
    WAS_PRESENT=0
  fi
  sleep "$INTERVAL"
done
