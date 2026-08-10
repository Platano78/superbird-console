# Flashing runbook — Car Thing → DeskThing

Derived from the [iFixit guide](https://www.ifixit.com/Guide/How+to+Install+Custom+Firmware+onto+Car+Thing/178814).
Corrections vs the `claude-thing` README are flagged ⚠.

## Environment facts (this box)

- Windows 11 Pro + WSL2. **Flash from Windows, not WSL** — WSL2 has no USB bus at all
  (`/sys/bus/usb/devices` does not exist; `lsusb` not installed).
- Terbium needs **WebUSB + File System Access API** → Chrome / Chromium / Edge on Windows.
- **Do NOT `usbipd attach` the device to WSL before flashing** — that takes it away from
  the Windows browser.
- `usbipd` lives at `/mnt/c/Program Files/usbipd-win/usbipd.exe` (not in System32).

## Pre-flight

Requires a **data-capable** USB-C cable (charge-only cables are a common failure).

```bash
# from WSL, to see what Windows sees:
"/mnt/c/Program Files/usbipd-win/usbipd.exe" list
```

Baseline observed 2026-07-31 — WigiDash present at `8-4 (28da:ef01)`, **no Car Thing**.
A stock post-Dec-2024 Car Thing may enumerate nothing useful in normal boot. Expected
identities during flashing: `GX-CHIP`, then *"unknown device from Amlogic, Inc"*.

## Step 1 — firmware + driver

1. Download the latest `x.x.x-thinglabs.zip` from **thingify.tools**. Extract somewhere accessible.
2. PowerShell **as Administrator**:
   ```powershell
   irm https://driver.terbium.app/get | iex
   ```
3. Open **terbium.app** in Chrome/Edge.

## Step 2 — boot mode

⚠ **Hold buttons 1 AND 4**, then plug in while holding. Wait several seconds, release.

- The `claude-thing` README says "holding preset 4" — iFixit's 1+4 is the general procedure
  and is the one to trust.
- ⚠ **A dark screen means it worked.** If the display lights up you are in normal boot,
  not boot mode. Unplug and retry.

## Step 3 — flash

In Terbium:

1. Connect → device shows as **`GX-CHIP`**
2. Device reconnects into burn mode → **Connect again**
3. Device shows as **"unknown device from Amlogic, Inc"** → select → Connect
4. **Restore Local Folder** → navigate to the extracted thinglabs folder → Open
5. Grant the browser directory access when prompted
6. **Select** to begin flashing

## Step 4 — DeskThing server

1. Download the **Windows** build from `DeskThing.App/Releases`.
2. Open → **Clients** → **Refresh ADB** if no device appears.
3. Setup can be skipped or customised (right arrow → Edit Config).
4. **Settings > Device** → enable **Auto Detect ADB**, **Use Global ADB**, **Auto Config**.

## ⚠ What a successful flash looks like (read before judging one)

`8.9.2-thinglabs` is **stock Spotify firmware plus tweaks — the main one being ADB enabled.**
Thing Labs: *"this image enables ADB, allowing us to copy files over to the CarThing."* It is
the image **recommended for DeskThing**.

Therefore, after a **correct** flash:
- the device still boots the **stock Spotify UI**;
- `/usr/share/qt-superbird-app/webapp/index.html` still reads `<title>Superbird</title>` with
  May 2020 timestamps.

⚠ **That title check is only valid on a FRESH flash.** Verified 2026-08-10: on this unit the same
file now reads `<title>DeskThing Client</title>` — DeskThing overwrote the directory after flashing.
Do not use the title as a post-hoc "was this flashed correctly" test on a device that has since had
tooling pointed at it; use `adb shell` working as root, which is the real gate.

**The pass gate is `adb shell` working as root**, not a changed webapp. DeskThing supplies the
UI over ADB at runtime; the firmware's only job is to make ADB available.

To inspect any firmware image *before* flashing — no device, no root, no mount:

```bash
debugfs -R "cat /usr/share/qt-superbird-app/webapp/index.html" system_a.ext2
debugfs -R "ls -l /usr/share/qt-superbird-app/webapp" system_a.ext2
```

Do this whenever the identity of a downloaded image matters. Assuming it and gating on the
assumption cost this project a full session of chasing a flash bug that never existed.

## ADB operating rules (post-flash)

Verified 2026-08-01, after a successful flash. A booted thinglabs device enumerates as
`1d6b:1014  Remote NDIS Compatible Device, ADB Interface` — **ADB and USB-ethernet
together**, in the same bus slot the `GX-CHIP` occupied. It authorizes immediately
(serial `DEVICESERIAL`); no on-device RSA prompt appears.

**Rule 1 — exactly one ADB server, and it must be Windows'.** The device is on Windows USB
and WSL2 has no USB bus, so only a Windows-side server can see it. Mirrored networking makes
WSL's and Windows' `127.0.0.1:5037` the *same* socket, so a WSL server silently steals the
port. Symptom of contention: the device lists once, then `no devices/emulators found`.

```bash
adb kill-server        # in WSL — keep it dead
```

**Rule 2 — `adb start-server` wedges on this box; that is a known, documented quirk.**
Root cause is *not* adb: under `networkingMode=mirrored` the Windows Hyper-V firewall filters
WSL sockets such that **connects to a CLOSED loopback port hang (DROP instead of RST)** — a
live `127.0.0.1` listener still answers in ~2 ms. adb's start-server probe to
`127.0.0.1:5037` expects an instant refusal and blocks forever instead. Established
loopback and LAN traffic are unaffected. Prior art, with the full diagnosis:
`~/.claude/docs/solutions/phonelinux-20260717-handoff.md:30-39` (phonelinux, 2026-07-17) —
**query that before re-deriving this.**

Two fixes, in order of preference:

*Windows-side server (what the DeskThing path needs) — detach the wedged probe:*

```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Programs\deskthing\resources\win\adb.exe" `
  -ArgumentList 'start-server' -WindowStyle Hidden -Wait
```

This works by side effect — it detaches the wedged probe long enough for the server to bind.
Once a listener exists on 5037, every later call answers fast. Symptom of the wedge is a call
that never returns; a *fast* `10061 actively refused` is the clean-firewall case, not a
different failure.

*WSL-side server (if WSL-native adb is ever wanted, e.g. after `usbipd attach`) — sidestep
loopback entirely with a unix domain socket:*

```bash
adb -L local:/tmp/claude-1000/adb-bridge/adb.sock nodaemon server &
export ADB_SERVER_SOCKET=local:/tmp/claude-1000/adb-bridge/adb.sock   # on EVERY adb call
```

The bridge dies with the boot — restart it if needed. `wsl --shutdown` is a maybe-fix only
(state reset; a persisted firewall rule brings the symptom back), and is not required.

DeskThing ships its own adb at `%LOCALAPPDATA%\Programs\deskthing\resources\win\adb.exe`;
there is also a global one at `C:\Program Files (x86)\ADB and Fastboot++\adb.exe`. Either
works — just don't run both servers.

**Rule 3 — the reverse tunnel** (⚠ **still unproven** — see `status.md`):

```powershell
& $adb reverse tcp:8790 tcp:8790
& $adb reverse --list                     # expect: <serial> tcp:8790 tcp:8790
& $adb shell "wget -qO- http://127.0.0.1:8790/status"   # or curl/nc, whatever the image has
```

A JSON blob containing `daemonVersion` from that last command is the pass condition. Nothing
short of it counts — `reverse` returning silently only means the tunnel was *registered*.

**Rule 4 — RNDIS is a second transport.** The same gadget exposes USB-ethernet (Windows
raises a `Remote NDIS Compatible Device` adapter). If `adb reverse` fails, try reaching the
host over that link by IP *before* falling back to Bluetooth PAN or a Pi.

## Recovery

Bricking is very unlikely — the device is always recoverable by re-entering flash mode
(1+4 while plugging in). Reflashing to a different firmware (Nocturne, Mira) is cheap,
so the firmware choice is reversible.

## Per-OS deltas (for reference)

- **macOS** — same as Windows, minus the driver command.
- **Linux** — same as macOS, plus udev rules before burn mode:
  ```bash
  curl -fsSL https://terbium.app/install-rules | bash
  ```
