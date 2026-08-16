#!/usr/bin/env bash
# One entry point to go from a fresh checkout to a running Car Thing surface,
# usable by a human OR an agent.
#
#   scripts/setup.sh                  detect config, write superbird.conf, install +
#                                      enable the systemd --user units
#   scripts/setup.sh --dry-run        print what it would do, change nothing
#   scripts/setup.sh --non-interactive
#                                      never prompt; fail with a clear message
#                                      + non-zero exit if something can't be
#                                      detected. This is the mode an agent uses.
#
# Idempotent: safe to run twice. Never overwrites an existing superbird.conf -- see
# the write_env step below.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# ⚠ Deliberately NOT ".env" in this repo's own working tree while it's being
# authored -- see superbird.conf.example's header comment. The path this script writes
# to, once renamed, is exactly "$REPO_ROOT/superbird.conf".
ENV_FILE="$REPO_ROOT/superbird.conf"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

DRY_RUN=0
NON_INTERACTIVE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      echo "setup.sh: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log()  { printf '[setup] %s\n' "$*"; }
fail() { printf '[setup] ERROR: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Detection (ruling: required config is auto-detected, not asked for)
# ---------------------------------------------------------------------------

# Prints an adb path to stdout, or returns non-zero if none was found.
detect_adb() {
  if [ -n "${CAR_THING_ADB:-}" ]; then
    if ! command -v "$CAR_THING_ADB" >/dev/null 2>&1; then
      echo "CAR_THING_ADB=$CAR_THING_ADB is set but not runnable (not found or not executable)." >&2
      return 1
    fi
    printf '%s' "$CAR_THING_ADB"
    return 0
  fi
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return 0
  fi
  # WSL2: the device is on the Windows USB bus, so WSL's own adb (if any)
  # can never see it -- only the Windows adb.exe can. Probe common
  # locations under /mnt/c/ rather than asking a human to look one up.
  if grep -qi microsoft /proc/version 2>/dev/null; then
    local pattern found=""
    for pattern in \
      "/mnt/c/Users/"*"/AppData/Local/Android/Sdk/platform-tools/adb.exe" \
      "/mnt/c/Users/"*"/AppData/Local/Programs/deskthing/resources/win/adb.exe" \
      "/mnt/c/Android/Sdk/platform-tools/adb.exe" \
      "/mnt/c/platform-tools/adb.exe"
    do
      for found in $pattern; do
        if [ -x "$found" ]; then
          printf '%s' "$found"
          return 0
        fi
      done
    done
  fi
  return 1
}

# Prints a serial to stdout on exactly one attached device. Returns 2 for
# zero devices, 3 for more than one (both are failures the caller must
# handle -- never silently pick one).
detect_serial() {
  local adb_bin="$1" lines count
  lines="$("$adb_bin" devices 2>/dev/null | tail -n +2 | tr -d '\r' | awk '$2=="device" {print $1}')"
  count=0
  if [ -n "$lines" ]; then count="$(printf '%s\n' "$lines" | grep -c .)"; fi
  case "$count" in
    1) printf '%s' "$lines"; return 0 ;;
    0) return 2 ;;
    *) printf '%s' "$lines" >&2; return 3 ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

log "repo: $REPO_ROOT"

ADB_BIN=""
if ADB_BIN="$(detect_adb)"; then
  log "adb: found at $ADB_BIN"
else
  fail "no adb found. Install platform-tools and put 'adb' on PATH, or set CAR_THING_ADB to its full path (on WSL2 this must be the Windows adb.exe -- see superbird.conf.example)."
fi

SERIAL=""
set +e
SERIAL="$(detect_serial "$ADB_BIN")"
serial_status=$?
set -e
case "$serial_status" in
  0)
    log "device: exactly one attached, serial=$SERIAL"
    ;;
  2)
    fail "no adb device attached. Plug in the Car Thing (and make sure the OS sees it as a USB device) before running setup again."
    ;;
  3)
    fail "more than one adb device attached -- can't pick one automatically. Detach the others, or set CAR_THING_SERIAL yourself to the right one from this list:
$SERIAL"
    ;;
esac

log "MB_HOST / MB_SSH_HOST / CODER_HOST / CONTROL_SCRIPTS_DIR are OPTIONAL (local LLM fleet add-on) -- left unset unless already present in the environment."

if [ "$DRY_RUN" -eq 1 ]; then
  log "--dry-run: would write $ENV_FILE with:"
  log "  CAR_THING_SERIAL=$SERIAL"
  log "  CAR_THING_ADB=$ADB_BIN"
  log "--dry-run: would install/enable systemd --user units into $SYSTEMD_USER_DIR"
  log "--dry-run: nothing was changed."
  exit 0
fi

# --- write env file ---------------------------------------------------------
if [ -e "$ENV_FILE" ]; then
  log "$ENV_FILE already exists -- leaving it untouched. Edit it by hand (see superbird.conf.example) to pick up newly detected values, or remove it and re-run setup.sh."
else
  {
    echo "# Written by scripts/setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "CAR_THING_SERIAL=$SERIAL"
    echo "CAR_THING_ADB=$ADB_BIN"
    echo "# Optional fleet vars -- see superbird.conf.example. Uncomment and fill in to enable:"
    echo "#MB_HOST="
    echo "#MB_SSH_HOST="
    echo "#CODER_HOST="
    echo "#CONTROL_SCRIPTS_DIR="
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "wrote $ENV_FILE"
fi

# --- install systemd --user units -------------------------------------------
mkdir -p "$SYSTEMD_USER_DIR"
UNITS=(
  "services/deviceinfo/car-thing-deviceinfo.service"
  "scripts/car-thing-backlight.service"
  "scripts/car-thing-rotary.service"
)
for unit in "${UNITS[@]}"; do
  cp "$REPO_ROOT/$unit" "$SYSTEMD_USER_DIR/$(basename "$unit")"
  log "installed $SYSTEMD_USER_DIR/$(basename "$unit")"
done

systemctl --user daemon-reload
for unit in "${UNITS[@]}"; do
  systemctl --user enable "$(basename "$unit")"
done
log "enabled: $(for u in "${UNITS[@]}"; do basename "$u"; done | tr '\n' ' ')"

cat <<EOF

Next steps:
  1. (optional) edit $ENV_FILE to turn on the local LLM fleet screen -- see superbird.conf.example.
  2. Restart the units to pick up this config:
       systemctl --user restart $(for u in "${UNITS[@]}"; do basename "$u"; printf ' '; done)
  3. Verify:  curl -s http://127.0.0.1:8791/state | head -c 200
  See INSTALL.md for the full walkthrough and verification steps.
EOF
