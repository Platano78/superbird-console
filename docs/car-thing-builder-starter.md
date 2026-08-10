# Car Thing builder starter — bring-up guide for custom web apps

For anyone who just got a Spotify Car Thing and wants to run their own web app on it.

## What this device actually is

An 800×480 touchscreen, a rotary dial, 4 preset buttons, a Back button, and an M button. No
speaker. Under the glass it runs a supervised Chromium kiosk on a Linux (Amlogic "superbird")
rootfs.

**The single fact that makes everything else make sense: you are not writing a native app. You
are writing a static web app that the device's Chromium kiosk loads from `file://` off the
device's own disk.** Every trap and every workflow below follows from that one sentence.

## 1. What you need

- A **data-capable** USB-C cable. Charge-only cables are a common failure mode — if the device
  never enumerates on the host, try a different cable before anything else.
- A Chromium-family browser (Chrome, Edge, or Chromium itself) on the machine you flash from.
  The web flasher needs **WebUSB** and the **File System Access API**, which only that browser
  family supports.
- The firmware image (below).

## 2. Flashing

Source: [thingify.tools](https://thingify.tools). Flasher: [terbium.app](https://terbium.app).
Guide lineage: the [iFixit custom-firmware guide](https://www.ifixit.com/Guide/How+to+Install+Custom+Firmware+onto+Car+Thing/178814).

**Step 1 — get the image and driver**

1. Download the latest `x.x.x-thinglabs.zip` from thingify.tools. Extract it somewhere
   accessible.
2. **Windows only** — install the driver, PowerShell as Administrator:
   ```powershell
   irm https://driver.terbium.app/get | iex
   ```
3. Open terbium.app in Chrome/Edge/Chromium.

**Step 2 — boot mode**

> ⚠ **Hold presets 1 AND 4**, then plug the cable in while still holding both. Wait several
> seconds, then release.
>
> **A dark screen means it worked.** If the display lights up, you're in normal boot, not flash
> mode — unplug and retry.

**Step 3 — flash, in Terbium**

1. Connect → device shows as **`GX-CHIP`**.
2. Device reconnects into burn mode → **Connect again**.
3. Device shows as **"unknown device from Amlogic, Inc"** → select it → Connect.
4. **Restore Local Folder** → navigate to the extracted thinglabs folder → Open.
5. Grant the browser directory access when prompted.
6. **Select** to begin flashing.

**Per-OS deltas**

| OS | Delta from the base procedure |
|---|---|
| Windows | as written above |
| macOS | same, minus the driver step |
| Linux | same as macOS, plus udev rules *before* entering burn mode: `curl -fsSL https://terbium.app/install-rules | bash` |

## 3. ⚠ What a successful flash looks like — read this before judging one

The `thinglabs` image is **stock Spotify firmware plus ADB enabled** — nothing more. After a
correct flash:

- the device still boots the **stock Spotify UI**;
- the stock webapp at `/usr/share/qt-superbird-app/webapp/index.html` is **unchanged**.

**The pass gate is `adb shell` working as root — not a changed-looking device.** A device that
still looks and behaves exactly like stock Spotify is the *expected, correct* outcome of a good
flash. This section exists because a real project lost a full working session chasing a "flash
bug" that never existed — the flash had succeeded and the device was behaving exactly as
designed; the mistake was expecting the UI to change.

To inspect a downloaded image's contents *before* flashing — no device, no root, no mount needed:

```bash
debugfs -R "cat /usr/share/qt-superbird-app/webapp/index.html" system_a.ext2
debugfs -R "ls -l /usr/share/qt-superbird-app/webapp" system_a.ext2
```

Run this whenever the identity of a downloaded image actually matters, instead of assuming it.

## 4. Getting ADB working

A booted `thinglabs` device enumerates as `1d6b:1014 Remote NDIS Compatible Device, ADB
Interface` — ADB and a USB-ethernet interface arrive together on the same USB slot the
`GX-CHIP` occupied during flashing. It authorizes immediately; no on-device RSA confirmation
prompt appears.

**Universal rule: run exactly one ADB server, and it must live on the OS that physically owns
the USB bus.** If you're on a VM, container, or a WSL-style Linux-on-Windows layer, that layer
almost certainly does *not* own the USB bus and cannot see the device at all — the server has to
run on the host that does.

### If you are on Windows + WSL2

This subsection is WSL2-specific. If you're on a native Windows install, native macOS, or
native Linux with no WSL2 layer involved, none of this applies — a normal `adb start-server`
just works.

**Symptom:** the device lists once with `adb devices`, then flips to `no devices/emulators
found`. **Cause:** WSL2 has no USB bus of its own — `/sys/bus/usb/devices` doesn't exist and
`lsusb` isn't installed under WSL2 — so the device is only ever visible to Windows. Under
`networkingMode=mirrored`, WSL's `127.0.0.1:5037` and Windows' `127.0.0.1:5037` are the *same
socket*, so a WSL-side ADB server silently steals the port from the Windows one. **Fix:** kill
the WSL-side server and keep it dead.

```bash
# in WSL
adb kill-server
```

**Symptom:** `adb start-server` on Windows just hangs and never returns. **Cause:** under
`networkingMode=mirrored`, the Windows Hyper-V firewall filters WSL-originated sockets such that
connects to a *closed* loopback port hang (dropped, not refused) instead of returning an instant
`RST`. A *live* `127.0.0.1` listener still answers in ~2 ms — this only affects the "is anything
listening yet" probe against a closed port. A fast `10061 actively refused` is the normal
clean-firewall case and is not this bug. **Fix (preferred) — detach the probe so the server can
bind:**

```powershell
Start-Process -FilePath "<path-to-your-adb.exe>" `
  -ArgumentList 'start-server' -WindowStyle Hidden -Wait
```

Once a listener exists on 5037, every subsequent call answers fast.

**Fix (alternative) — sidestep loopback entirely with a Unix domain socket**, useful if you
need WSL-native ADB (e.g. after attaching the device to WSL with `usbipd`):

```bash
adb -L local:/tmp/adb-bridge/adb.sock nodaemon server &
export ADB_SERVER_SOCKET=local:/tmp/adb-bridge/adb.sock   # set this on EVERY adb call
```

This bridge process dies on reboot/shutdown; restart it as needed.

## 5. Putting your own app on the device

- The rootfs mounts `ro`, but remounting it read-write succeeds:
  ```bash
  adb shell "mount -o remount,rw /"
  ```
- **Back up the supervisor config before you edit it**, so §11's revert always has something to
  restore:
  ```bash
  adb shell "mount -o remount,rw / && cp -n /etc/supervisord.conf /etc/supervisord.conf.stock"
  ```
  `cp -n` won't clobber an existing backup, so this is safe to run more than once.
- `/etc/supervisord.conf`, around line 51, holds the kiosk's launch command line, including:
  ```
  --kiosk --app=file:///usr/share/qt-superbird-app/webapp/index.html
  ```
- Put your built app in its own directory under `/usr/share/` (e.g.
  `/usr/share/my-app/`) and edit that line to point at your app's `index.html` instead.
- **Leave the stock Spotify webapp directory intact.** Don't overwrite or delete
  `/usr/share/qt-superbird-app/webapp/` — pointing the supervisor line back at it is then a
  one-line revert (see §11).
- Space is not a constraint: roughly 172 MB free was measured against a real deployed bundle of
  ~250 KB.

**The deploy loop** — build, push, restart the kiosk. From your own machine:

```bash
npm run build   # or your framework's equivalent
```

Device side (adjust the app directory name to whatever you chose):

```bash
adb shell "mount -o remount,rw / && rm -rf /usr/share/my-app/assets"
adb push <your-dist-dir>/. /usr/share/my-app/
adb shell "supervisorctl restart chromium"
```

## 6. ⚠ The `file://` ES-module trap

**Symptom:** the device shows a blank screen. No visible error anywhere obvious. **Cause:**
the kiosk loads your app over `file://`, and browsers refuse to execute
`<script type="module">` from a `file://` URL — the failure is
`Failed to load module script: The server responded with a non-JavaScript MIME type of ""`,
visible only if you happen to be watching devtools when it loads. A default modern bundler
output (ES modules only) will build fine, deploy fine, and simply never run. **Fix:** the build
must emit a **classic-script** (`nomodule`) bundle, not ES modules.

Working Vite config (verified against real hardware):

```ts
import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [
    legacy({ targets: ['chrome >= 69'], renderLegacyChunks: true }),
  ],
  base: './',
  build: { target: 'es2017', assetsInlineLimit: 0, cssCodeSplit: false },
})
```

**Version pin:** on `vite@5`, use `@vitejs/plugin-legacy@^5` — `@vitejs/plugin-legacy@8`
requires `vite@8`, so pin the pair together.

**Corroborating evidence this is the right fix, not a guess:** the stock Spotify webapp itself
ships the same legacy pair (`index-legacy-*.js` + `polyfills-legacy-*.js`) for exactly this
reason.

**Framework choice is free.** React, Vue, Svelte, or vanilla JS all work fine — the only hard
requirements are classic-script output and `chrome >= 69`-era build targets. If you're not using
Vite, find your bundler's equivalent legacy/nomodule output mode.

## 7. Physical controls

`gpio-keys` is `kbd`-handled on this device, so Chromium receives every physical button as an
ordinary `keydown` event on `window` — no native code or bridge needed to read them.

| Control | `event.code` |
|---|---|
| Preset 1 | `Digit1` |
| Preset 2 | `Digit2` |
| Preset 3 | `Digit3` |
| Preset 4 | `Digit4` |
| Dial press | `Enter` |
| Back | `Escape` |
| M / front button | `KeyM` |

> ⚠ **The dial's rotation is not usable from the web app.** The rotary encoder reports
> `Handlers=event1` at the kernel level with **no `kbd` handler attached**, meaning Chromium
> never sees rotation events at all — only the dial's *press* comes through as `Enter`. If your
> UI wants to react to spinning the dial, you need an evdev→uinput bridge on the device side;
> there is no way to read it from the web app alone.

Hard-won UX defaults worth copying into any button-driven UI on this hardware:

- **Ignore auto-repeat** — holding a button should not fire the action twice.
- **Arm delay after a UI appears** — a press already in flight when new UI pops up should not
  blind-fire against it; a short delay (on the order of a couple hundred ms) before accepting
  input avoids this.
- **Explicit visual feedback on key press** — CSS `:active` states never trigger for
  keyboard-style input (which is what these button presses arrive as), so any "this button was
  pressed" feedback has to be driven manually in code, not left to CSS.

## 8. Screen brightness / backlight

The backlight is a sysfs value:

```bash
adb shell "cat /sys/class/backlight/aml-bl/brightness"     # read, 0-255
adb shell "echo 200 > /sys/class/backlight/aml-bl/brightness"   # write, 0-255
```

> ⚠ **The stock ambient-light daemon fights you.** `sp-als-backlight` continuously re-drives
> brightness toward its own ambient-light target — measured climbing back at roughly 26
> units/second after being overridden. It is supervised with `autorestart=true`, so **`kill`ing
> it just respawns it** — that is not the lever. The right lever is stopping it through the
> supervisor that owns it:
> ```bash
> adb shell "supervisorctl stop backlight"    # your writes now hold
> adb shell "supervisorctl start backlight"   # hand control back to ALS
> ```

**Readback caveat:** the driver rounds on write — e.g. writing 234 reads back as 235, writing
172 reads back as 173. Never assert exact equality between what you wrote and what you read
back.

There's no speaker on this device, so if you want an out-of-band signal (e.g. "something needs
attention"), the backlight is the only channel available.

## 9. Debugging what's actually on screen

The kiosk's Chromium runs with `--remote-debugging-port=2222`. This is the feedback loop that
replaces asking someone to physically look at the device — treat it as your primary debugging
tool, especially for anything AI-agent-driven.

```bash
adb forward tcp:9222 tcp:2222
curl -s http://127.0.0.1:9222/json/list        # lists debuggable targets, incl. webSocketDebuggerUrl
```

Attach a WebSocket client to the page's `webSocketDebuggerUrl` from that list and use the Chrome
DevTools Protocol:

- `Runtime.evaluate` with `document.body.innerText` — read what's actually rendered.
- `Runtime.enable` — subscribe to console output and uncaught exceptions.

This is the single highest-leverage tool in this whole guide if you're driving the device from
a script or an agent rather than sitting in front of it — use it instead of guessing why
something looks wrong.

## 10. Talking to a service on your own computer

If your app needs to reach something running on the machine you develop on, you have two
transports on the same USB link.

**`adb reverse`** — makes a port on the *device* forward to a port on your *host*:

```bash
adb reverse tcp:<port> tcp:<port>
adb reverse --list                     # confirm registration: <serial> tcp:<port> tcp:<port>
```

> ⚠ **`adb reverse` returning silently only means the tunnel was *registered* — not that it
> works.** The actual pass condition is a device-side request returning real data:
> ```bash
> adb shell "wget -qO- http://127.0.0.1:<port>/your-endpoint"
> ```
> A real response body is the proof. On real hardware this was also corroborated with a
> WebSocket handshake to a `/ws` endpoint that returned `HTTP/1.1 101` — that status line plus a
> valid `Sec-WebSocket-Accept` header is what a working upgrade looks like if your service uses
> WebSockets.

The device drops off USB periodically, which drops the tunnel with it. If you need this to stay
up unattended, re-assert the `adb reverse` command on a loop (a 30-second interval was used and
found reliable) rather than assuming it survives.

**RNDIS / USB-ethernet** is a second, independent transport exposed on the same USB gadget — the
host sees a `Remote NDIS Compatible Device` network adapter. If `adb reverse` isn't working for
some reason, reaching your host service over that adapter's IP is worth trying before reaching
for anything more exotic (Bluetooth, a relay box, etc).

**Security note:** if you bind your host-side service to anything beyond `127.0.0.1`, it becomes
reachable from your whole LAN, not just the device. Keep it loopback-only unless the service has
real authentication.

## 11. Reverting to stock / recovery

The stock Spotify webapp was never touched by any of the above — it's still sitting at
`/usr/share/qt-superbird-app/webapp/`. To point the kiosk back at it and restore the original
supervisor config:

```bash
adb shell "mount -o remount,rw / && cp /etc/supervisord.conf.stock /etc/supervisord.conf && supervisorctl restart chromium"
```

> ⚠ This assumes `/etc/supervisord.conf.stock` exists — either because you created it in §5
> before your first edit (do that), or because your image shipped one. **Whether a stock
> `thinglabs` build ships that backup is UNVERIFIED**, so don't count on it. With no backup,
> manually edit the `--app=file://...` line in `/etc/supervisord.conf` back to
> `file:///usr/share/qt-superbird-app/webapp/index.html` instead.

**Bricking is very unlikely.** The device is always recoverable by re-entering flash mode
(hold presets 1+4 while plugging in, per §2) and reflashing. Firmware choice is a reversible
decision, not a one-way door.

## Ecosystem note: DeskThing

[DeskThing](https://deskthing.app) is a popular existing app platform/ecosystem for this
device, with a cross-platform (Windows/macOS/Linux) server and an SDK for building apps against
it. It's worth a look if you want a ready-made app ecosystem instead of building your own kiosk
app from scratch. It is **not required** for anything in this guide — the `thinglabs` firmware
alone gives you root ADB and a Chromium kiosk, which is everything §5–§10 above need.

## First-app checklist

Work through in order. Each step is something you can directly verify, not a vibe.

1. Data-capable USB-C cable connects the device to your computer.
2. Device held presets 1+4 while plugging in → screen went **dark**.
3. Terbium flashed the `thinglabs` image without error.
4. Device rebooted into the **stock Spotify UI** (this is correct, not a failure — see §3).
5. `adb devices` lists the unit as authorized, no manual confirmation needed on-device.
6. `adb shell` returns a working root shell.
7. `mount -o remount,rw /` succeeds.
8. Your built app (with the legacy/nomodule bundle from §6) is pushed to its own directory
   under `/usr/share/`.
9. `/etc/supervisord.conf` line ~51 points at your app's `index.html`.
10. `supervisorctl restart chromium` — your app, not the Spotify UI, is now on screen.
11. A physical preset button press produces a `keydown` event you can observe (via a console log
    or CDP `Runtime.evaluate`, per §9).
12. You can revert to stock (§11) and get the Spotify UI back, confirming the fallback path
    works before you rely on it.
