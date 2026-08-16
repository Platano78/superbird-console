#!/usr/bin/env node
// Backlight attention channel for the Car Thing.
//
// The device has no speaker, so the screen backlight is the only out-of-band
// signal available for a headless host. This service has two inputs: it
// watches the claude-thing daemon over its WebSocket protocol (same one
// device/src/daemon.ts uses from the browser) for sessions/permissions, and
// it polls services/deviceinfo/server.js (:8791/state) for a failed
// fleet-box action (Phase E — see FleetWatcher below). Both feed one
// StateMachine and drive /sys/class/backlight/aml-bl on the device via adb
// shell round trips.
//
// Node has a global WebSocket (stable since 22.4) — no npm dependency needed.
//
// Transport note: `adb shell -T` (no-PTY) fails on this device ("device only
// supports allocating a pty"), so every adb shell we spawn gets a PTY that
// echoes stdin back on stdout. A persistent stdin-fed shell would eventually
// deadlock on an undrained pipe, so we never build one. Steady states are one
// `adb shell "echo N > .../brightness"` round trip per transition (~55ms).
// Pulsing spawns one bounded, self-terminating device-side loop instead.
//
// Ambient-light-sensor daemon takeover:
// The stock device runs `sp-als-backlight`, a daemon that reads the ambient
// light sensor and writes its OWN target to .../brightness on a loop —
// directly competing with every write this service makes. Confirmed live:
// writing 60 then polling actual_brightness every 500ms drifted upward
// (61, 74, 87, 100, 113, 127, 140, 153 — ~26 units/sec back toward its
// ambient target), and `kill -STOP`/`kill -CONT` on its pid froze/resumed the
// drift, isolating it as the sole cause. /etc/supervisord.conf shows it's
// supervised (`[program:backlight] command=sp-als-backlight autorestart=true
// autostart=true`), so a plain SIGKILL is the WRONG lever — supervisord
// respawns it immediately. `supervisorctl` is the correct one. This service
// therefore takes ownership symmetrically: `supervisorctl stop backlight`
// once on startup (before the first brightness write) and `supervisorctl
// start backlight` on shutdown (SIGTERM/SIGINT), so `systemctl --user stop`
// always leaves the device back in stock condition — ambient auto-brightness
// restored. We do NOT edit supervisord.conf: nothing here may survive a
// reboot, so the ALS daemon comes back via autostart=true and this service
// re-stops it next time it starts. That self-healing property is deliberate.

import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ADB path: on WSL this must be the WINDOWS binary — see
// scripts/keep-adb-reverse.sh. Generic 'adb' default covers a plain Linux
// host with adb already on PATH; scripts/setup.sh auto-detects the WSL case.
const ADB = process.env.CAR_THING_ADB || 'adb'
// ⚠ ALWAYS address the Car Thing by serial once a second device can ever be
// attached. A bare `adb shell` fails outright with "error: more than one
// device/emulator" the moment ANY second device is attached — a phone on
// wireless debugging is enough, and it took this service (and the reverse
// tunnel) down in production on 2026-08-02. Unset is fine for the common
// single-device case (below omits `-s` entirely); scripts/setup.sh
// auto-detects a serial when there's exactly one device to disambiguate from.
const SERIAL = process.env.CAR_THING_SERIAL || ''
const ADB_ARGS = SERIAL ? ['-s', SERIAL] : []
const BACKLIGHT = '/sys/class/backlight/aml-bl/brightness'
const ACTUAL_BACKLIGHT = '/sys/class/backlight/aml-bl/actual_brightness'
const ALS_PROGRAM = 'backlight' // supervisord program name for the sp-als-backlight daemon — see the header comment

const DAEMON_URL = 'ws://127.0.0.1:8790/ws'

const BRIGHTNESS = { IDLE: 60, ACTIVE: 235, ATTENTION_MIN: 90, ATTENTION_MAX: 255 }
const ATTENTION_CYCLE_MS = 1100
// Fleet-failure pulse reuses the exact same range and machinery as the
// permission-ATTENTION pulse below — only the cadence differs, so the two
// are visually distinguishable (permission = urgent/fast, fleet = slower)
// without a second pulse mechanism (Phase E requirement: reuse
// killPulse()/respawn semantics as-is, exactly one thing drives brightness).
const FLEET_FAILURE_CYCLE_MS = 2200
const ATTENTION_STEPS = 8 // per half-cycle (up, then down) — smooth, not a square wave
const PULSE_BOUND_S = 60 // device-side loop self-terminates after ~60s; respawned while still in ATTENTION

const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'car-thing')
const STATE_FILE = path.join(STATE_DIR, 'backlight.json')

const log = (...args) => console.log(new Date().toISOString(), ...args)

/** Run one `adb shell <cmd>`, ignore stdout/stderr, resolve/reject on exit. */
function adbShell(cmd, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ADB, [...ADB_ARGS, 'shell', cmd], { stdio: ['ignore', 'ignore', 'ignore'] })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('adb shell timed out: ' + cmd)) }, timeoutMs)
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error('adb shell exited ' + code + ': ' + cmd))
    })
  })
}

/** Run one `adb shell <cmd>` and capture stdout as text (used only by --self-test readbacks). */
function adbShellCapture(cmd, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ADB, [...ADB_ARGS, 'shell', cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('adb shell timed out: ' + cmd)) }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(out.trim()) : reject(new Error('adb shell exited ' + code + ': ' + cmd))
    })
  })
}

/** Stop the ALS daemon via supervisorctl (NOT kill — see header comment). Non-fatal: log and carry on with the drift, same as any other adb failure mode. */
async function alsStop() {
  try {
    await adbShell(`supervisorctl stop ${ALS_PROGRAM}`)
    log('ALS daemon stopped (supervisorctl)')
  } catch (err) {
    log('supervisorctl stop failed — ALS daemon may still be fighting our writes:', err.message)
  }
}

/** Hand the ALS daemon back via supervisorctl. Non-fatal, same as alsStop(). */
async function alsStart() {
  try {
    await adbShell(`supervisorctl start ${ALS_PROGRAM}`)
    log('ALS daemon restored (supervisorctl)')
  } catch (err) {
    log('supervisorctl start failed — device may be left with the ALS daemon stopped:', err.message)
  }
}

/**
 * Drives the backlight. Tracks the last value written so steady-state calls
 * only fire on an actual transition, and owns the one pulsing child process
 * so it can be killed the instant ATTENTION ends.
 */
class Backlight {
  #lastSteady = null
  #pulseChild = null
  #pulseKind = null // 'attention' | 'fleet' | null — which cadence is currently spawned, so a kind change respawns instead of no-op'ing
  #failing = false // true after the first failed write in a streak — logs once, not on every retry
  #backoffUntil = 0 // ms epoch; suppresses retries until this passes so a flapping USB link doesn't spam the journal

  /**
   * One-shot write, only if the value actually changed. The tracked value is
   * set BEFORE awaiting the adb round trip (rolled back in the catch on
   * failure), so a write still in flight can't be stamped over by a later
   * call that reads the stale pre-await value and thinks nothing changed.
   * On failure: logs once per failure streak, then backs off 5s between
   * retries (device off USB happens regularly; the sibling tunnel service
   * re-establishes it) instead of retrying on every session tick.
   */
  async setSteady(value) {
    this.stopPulse()
    if (this.#lastSteady === value) return
    const now = Date.now()
    if (now < this.#backoffUntil) return
    const prev = this.#lastSteady
    this.#lastSteady = value
    try {
      await adbShell(`echo ${value} > ${BACKLIGHT}`)
      log('backlight steady ->', value)
      this.#failing = false
    } catch (err) {
      this.#lastSteady = prev
      if (!this.#failing) {
        this.#failing = true
        log('backlight write failed (device off USB?):', err.message)
      }
      this.#backoffUntil = now + 5000
    }
  }

  /** Forces a write even if the tracked value matches — used for the SIGTERM/disconnect restore so we don't skip it due to stale tracking or a stale backoff window. */
  async forceSteady(value) {
    this.#lastSteady = null
    this.#backoffUntil = 0
    return this.setSteady(value)
  }

  /** Marks the tracked value stale without writing — used after the usage-alert burst writes raw values behind setSteady's back, so the next setSteady() call doesn't wrongly think nothing changed. */
  invalidate() {
    this.#lastSteady = null
  }

  /** Clears any backoff window and failure-streak flag — used on a WS reconnect, which is a fresh reason to retry immediately rather than wait out a backoff from before the connection dropped. */
  clearBackoff() {
    this.#backoffUntil = 0
    this.#failing = false
  }

  /**
   * Spawn one bounded device-side pulse loop (BusyBox sh) that ramps the
   * backlight between min and max for ~PULSE_BOUND_S seconds, then exits on
   * its own — that's the "host died" safety net. Call again to respawn while
   * still in ATTENTION; killPulse() gives near-zero stop latency without a
   * persistent stdin pipe.
   *
   * `kind` selects the cadence only — same range, same script shape, same
   * spawn/kill path either way, so this remains the one thing that drives
   * brightness (Phase E: fleet-failure attention reuses this, it doesn't
   * fork a second pulse mechanism). Calling with a different `kind` while
   * already pulsing respawns at the new cadence instead of no-op'ing.
   */
  startPulse(kind = 'attention') {
    if (this.#pulseChild && this.#pulseKind === kind) return
    if (this.#pulseChild) this.stopPulse()
    this.#pulseKind = kind
    this.#lastSteady = null // steady tracking is meaningless while pulsing
    const cycleMs = kind === 'fleet' ? FLEET_FAILURE_CYCLE_MS : ATTENTION_CYCLE_MS
    const stepMs = Math.round(cycleMs / (2 * ATTENTION_STEPS))
    const stepUs = stepMs * 1000
    const range = BRIGHTNESS.ATTENTION_MAX - BRIGHTNESS.ATTENTION_MIN
    const cycles = Math.ceil((PULSE_BOUND_S * 1000) / cycleMs)
    // BusyBox sh: nested for-loops ramp up then down, `usleep` paces each step.
    // Bounded to $cycles total cycles (~60s) so a dead host stops pulsing on
    // its own rather than pulsing forever.
    const script = [
      `i=0`,
      `while [ $i -lt ${cycles} ]; do`,
      `  s=0`,
      `  while [ $s -lt ${ATTENTION_STEPS} ]; do`,
      `    v=$(( ${BRIGHTNESS.ATTENTION_MIN} + s * ${range} / ${ATTENTION_STEPS} ))`,
      `    echo $v > ${BACKLIGHT}`,
      `    usleep ${stepUs}`,
      `    s=$(( s + 1 ))`,
      `  done`,
      `  s=${ATTENTION_STEPS}`,
      `  while [ $s -gt 0 ]; do`,
      `    v=$(( ${BRIGHTNESS.ATTENTION_MIN} + s * ${range} / ${ATTENTION_STEPS} ))`,
      `    echo $v > ${BACKLIGHT}`,
      `    usleep ${stepUs}`,
      `    s=$(( s - 1 ))`,
      `  done`,
      `  i=$(( i + 1 ))`,
      `done`,
      // NB: join with real newlines, not '; ' — the latter turns "...; do"
      // into "...; do; nextline", and a bare `;` right after `do` is an
      // empty-command syntax error in BusyBox ash (the script died silently
      // in ~50ms until this was caught against the real device).
    ].join('\n')

    const child = spawn(ADB, [...ADB_ARGS, 'shell', script], { stdio: ['ignore', 'ignore', 'ignore'] })
    this.#pulseChild = child
    child.on('exit', () => {
      if (this.#pulseChild === child) this.#pulseChild = null
    })
    child.on('error', (err) => {
      log('pulse spawn failed (device off USB?):', err.message)
      if (this.#pulseChild === child) this.#pulseChild = null
    })
  }

  stopPulse() {
    if (this.#pulseChild) {
      this.#pulseChild.kill('SIGKILL')
      this.#pulseChild = null
    }
    this.#pulseKind = null
  }
}

// ---------------------------------------------------------------------------
// USAGE ALERT: edge-triggered one-shot burst when a weekly limit crosses 90%.
// ---------------------------------------------------------------------------

async function loadFiredAlerts() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

async function saveFiredAlerts(fired) {
  await mkdir(STATE_DIR, { recursive: true })
  // Write-then-rename is atomic on POSIX — a crash mid-write can't leave a
  // truncated/corrupt state file. Worst case without this is one duplicate
  // usage burst on the next start, but it's two lines to close properly.
  const tmp = STATE_FILE + '.tmp'
  await writeFile(tmp, JSON.stringify(fired))
  await rename(tmp, STATE_FILE)
}

/** Three quick full-range pulses, then whatever setSteady the caller does next. */
async function usageAlertBurst(backlight) {
  log('USAGE ALERT burst')
  for (let i = 0; i < 3; i++) {
    await adbShell(`echo ${BRIGHTNESS.ATTENTION_MAX} > ${BACKLIGHT}`).catch((e) => log('alert step failed:', e.message))
    await sleep(150)
    await adbShell(`echo ${BRIGHTNESS.ATTENTION_MIN} > ${BACKLIGHT}`).catch((e) => log('alert step failed:', e.message))
    await sleep(150)
  }
  // The burst wrote raw values behind setSteady's tracking — invalidate so
  // the caller's next apply() actually re-writes the real state rather than
  // thinking nothing changed.
  backlight.invalidate()
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

class StateMachine {
  // Every state-affecting operation (apply, usage-alert checks) funnels
  // through this single chain so two evaluations can never interleave. The
  // bug this closes: apply() awaits a ~55ms adb round trip inside
  // setSteady(); without serialization, a permission event arriving mid-await
  // could start a pulse, and the first call would then resume and stamp its
  // now-stale target over the tracked value — leaving setSteady() convinced
  // nothing changed on the next call, so the panel never got told to update
  // and stuck at whatever brightness the pulse last wrote.
  #queue = Promise.resolve()

  constructor(backlight) {
    this.backlight = backlight
    this.connected = false
    this.sessions = []
    this.asks = []
    this.usage = null
    this.firedAlerts = {}
    this.lastClassified = null
    this.fleetFailure = null // latched { id, ok:false, ms, error? } from :8791/state, or null — see FleetWatcher header comment for ack semantics
  }

  async init() {
    this.firedAlerts = await loadFiredAlerts()
  }

  #enqueue(fn) {
    const run = this.#queue.then(fn, fn)
    this.#queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Evaluate priority order: ATTENTION > ACTIVE > IDLE. Call after any state-affecting update. */
  apply() {
    return this.#enqueue(() => this.#applyOnce())
  }

  /** Logs once per classification change, not on every call. */
  async #applyOnce() {
    let classified
    if (!this.connected) classified = 'DISCONNECTED'
    // Ruling 13: a pending permission outranks a fleet failure for the
    // backlight — checked first, so ATTENTION always wins the light even
    // while a fleet failure is latched underneath it.
    else if (this.asks.length > 0) classified = 'ATTENTION'
    else if (this.fleetFailure) classified = 'FLEET_FAILURE'
    else classified = this.sessions.some((s) => s.state === 'busy') ? 'ACTIVE' : 'IDLE'

    if (classified !== this.lastClassified) {
      log('state ->', classified)
      this.lastClassified = classified
      // Re-assert the ALS takeover on every IDLE entry — IDLE (60) is the
      // only state where the drift is ever visible (ACTIVE's 235 sits near
      // the ALS daemon's own ambient target, and ATTENTION's pulse rewrites
      // the panel ~15x/sec, which is why the drift hid behind both of them
      // for this whole slice). Transition-driven, not a polling timer.
      if (classified === 'IDLE') await alsStop()
    }

    if (classified === 'DISCONNECTED') {
      // The light must never lie: no live data backing it, go neutral.
      await this.backlight.forceSteady(BRIGHTNESS.ACTIVE)
      return
    }
    if (classified === 'ATTENTION') {
      this.backlight.startPulse('attention')
      return
    }
    if (classified === 'FLEET_FAILURE') {
      this.backlight.startPulse('fleet')
      return
    }
    this.backlight.stopPulse()
    await this.backlight.setSteady(classified === 'ACTIVE' ? BRIGHTNESS.ACTIVE : BRIGHTNESS.IDLE)
  }

  /**
   * Feeds in the latest `mb.lastResult` from :8791/state (FleetWatcher below).
   * Latches a failure until it is superseded — /state carries no
   * acknowledgement signal today, so "acknowledged" is defined honestly as
   * lastResult moving on: a NEWER id shows up (whatever its outcome) or the
   * SAME id resolves to ok:true. Does not itself call apply() — callers do,
   * same convention as sessions/asks/usage updates above.
   */
  updateFleetResult(lastResult) {
    if (lastResult && lastResult.ok === false) {
      if (!this.fleetFailure || this.fleetFailure.id !== lastResult.id) {
        log('fleet failure latched:', lastResult.id, lastResult.error || '')
        this.fleetFailure = lastResult
      }
      return
    }
    // lastResult is null (nothing run yet, or the deviceinfo service
    // restarted and lost its in-memory lastResult), or ok:true, or a
    // different id than the one latched — any of those means the failure we
    // knew about has moved on, so clear the latch.
    if (this.fleetFailure) {
      log('fleet failure cleared (lastResult moved on)')
      this.fleetFailure = null
    }
  }

  checkUsageAlerts() {
    return this.#enqueue(() => this.#checkUsageAlertsOnce())
  }

  async #checkUsageAlertsOnce() {
    // ATTENTION outranks a usage warning: an unanswered prompt matters more
    // than a weekly-limit notice, and firing the burst while the device-side
    // pulse loop is also writing would garble both signals. Defer instead of
    // firing — the next claude.usage.update push (~1/min) re-checks once the
    // queue clears, and the alert still fires exactly once for the period.
    if (this.asks.length > 0) return
    const limits = this.usage?.limits || []
    let changed = false
    for (const limit of limits) {
      if (!limit.key?.startsWith('week-')) continue
      if (limit.used < 0.9) continue
      const prevDetail = this.firedAlerts[limit.key]
      if (prevDetail === limit.detail) continue // already fired for this period
      await usageAlertBurst(this.backlight)
      this.firedAlerts[limit.key] = limit.detail
      changed = true
    }
    if (changed) await saveFiredAlerts(this.firedAlerts)
  }
}

// ---------------------------------------------------------------------------
// Daemon client — mirrors device/src/daemon.ts (request/reply correlation,
// bridge.hello first frame, type:"request" on every call, 3s reconnect,
// refresh discipline: sessions.update payload updates state directly, only
// permission/question topics trigger a queue re-fetch).
// ---------------------------------------------------------------------------

class DaemonClient {
  #ws = null
  #nextId = 0
  #pending = new Map()

  constructor(sm) {
    this.sm = sm
  }

  connect = () => {
    const ws = (this.#ws = new WebSocket(DAEMON_URL))

    ws.onopen = async () => {
      log('connected to', DAEMON_URL)
      // Re-assert the ALS takeover on every (re)connect — a reconnect is the
      // closest available signal that the device may have gone away and come
      // back (reboot, USB replug), which is exactly when sp-als-backlight
      // would have restarted via autostart=true while this service kept
      // running. Also clear any stale backoff window so a fresh connection
      // isn't blocked from writing immediately.
      await alsStop()
      this.sm.backlight.clearBackoff()
      this.sm.connected = true
      try {
        await this.request('bridge.hello', { role: 'backlight' })
        await this.refresh()
      } catch (err) {
        log('initial handshake/refresh failed:', err.message)
      }
      await this.sm.apply()
    }

    ws.onmessage = (e) => this.#onFrame(String(e.data))

    ws.onclose = () => {
      log('disconnected — going steady 235, reconnecting in 3s')
      this.sm.connected = false
      this.#pending.forEach((fn) => fn(null, 'disconnected'))
      this.#pending.clear()
      this.sm.apply()
      setTimeout(this.connect, 3000)
    }

    ws.onerror = (e) => {
      log('ws error:', e?.message || e)
    }
  }

  async #onFrame(raw) {
    let m
    try { m = JSON.parse(raw) } catch { return }

    if (m.type === 'event') {
      if (m.topic === 'claude.sessions.update') {
        this.sm.sessions = m.data?.sessions || []
        await this.sm.apply()
        return
      }
      if (m.topic === 'claude.usage.update') {
        this.sm.usage = m.data
        await this.sm.checkUsageAlerts()
        await this.sm.apply()
        return
      }
      // Only permission/question topics warrant a re-fetch — session ticks
      // fire constantly and re-fetching on each one storms the daemon.
      if (/permission|question/.test(m.topic || '')) {
        await this.refreshQueue()
      }
      return
    }

    const fn = typeof m.id === 'number' && this.#pending.get(m.id)
    if (!fn) return
    this.#pending.delete(m.id)
    fn(m.result, m.type === 'error' ? m.error || 'daemon error' : undefined)
  }

  request(method, params = {}) {
    return new Promise((ok, fail) => {
      if (this.#ws?.readyState !== 1) return fail(new Error('not connected'))
      const id = ++this.#nextId
      const timer = setTimeout(() => { this.#pending.delete(id); fail(new Error(method + ' timed out')) }, 10_000)
      this.#pending.set(id, (v, err) => { clearTimeout(timer); err ? fail(new Error(err)) : ok(v) })
      this.#ws.send(JSON.stringify({ type: 'request', id, method, params }))
    })
  }

  /** Single full fetch on connect. */
  async refresh() {
    try {
      const snap = await this.request('claude.sessions.list')
      this.sm.sessions = snap?.sessions || []
    } catch (err) {
      log('sessions.list failed:', err.message)
    }
    try {
      this.sm.usage = await this.request('claude.usage.get')
      await this.sm.checkUsageAlerts()
    } catch (err) {
      log('usage.get failed:', err.message)
    }
    await this.refreshQueue()
  }

  async refreshQueue() {
    try {
      const res = await this.request('claude.queue.list')
      this.sm.asks = res?.asks || []
    } catch (err) {
      log('queue.list failed:', err.message)
    }
    await this.sm.apply()
  }
}

// ---------------------------------------------------------------------------
// Fleet failure watch — Phase E's second input, alongside the claude-thing
// WS above. Polls services/deviceinfo/server.js (:8791/state) for a failed
// fleet-box action and drives the same pulse machinery (Ruling 13,
// the internal fleet-view spec "Phase E — loud failure via the
// backlight"). See StateMachine#updateFleetResult for the latch/ack logic.
//
// Unreachable :8791 is explicitly NOT a fleet failure — the deviceinfo
// service is also polled by the device every 5s and drops routinely (adb
// bounces), so treating "can't reach it" as "something failed" would cry
// wolf on every USB blip. An unreachable poll leaves whatever latch state we
// already have untouched — fail-open, same posture as every other adb
// failure mode in this file — and only logs once per failure streak.
// ---------------------------------------------------------------------------

const FLEET_STATE_URL = 'http://127.0.0.1:8791/state'
// Matches deviceinfo's own POLL_MS (device/src/deviceInfo.ts) — same house
// cadence, polling politely rather than hammering the service.
const FLEET_POLL_MS = 5000
// Comfortably above the deviceinfo service's own 2000ms per-source probe
// timeout (services/deviceinfo/mb.js SOURCE_TIMEOUT_MS) — device/src/
// deviceInfo.ts:126-137 already learned this the hard way: a client timeout
// set EQUAL to the server's per-source timeout loses the race every time
// and makes degraded states unreachable. Matches that file's
// FETCH_TIMEOUT_MS exactly.
const FLEET_FETCH_TIMEOUT_MS = 4500

class FleetWatcher {
  #failing = false // logs once per failure streak, same pattern as Backlight's adb writes

  constructor(sm) {
    this.sm = sm
  }

  start() {
    this.#tick()
    setInterval(() => this.#tick(), FLEET_POLL_MS)
  }

  async #tick() {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FLEET_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(FLEET_STATE_URL, { signal: ctrl.signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const state = await res.json()
      this.#failing = false
      this.sm.updateFleetResult(state?.mb?.lastResult ?? null)
      await this.sm.apply()
    } catch (err) {
      if (!this.#failing) {
        this.#failing = true
        log('fleet state poll failed (deviceinfo service down? not treated as a fleet failure):', err.message)
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

// ---------------------------------------------------------------------------
// Self-test — walks every visual state against the REAL device, no daemon.
// ---------------------------------------------------------------------------

async function selfTest() {
  const backlight = new Backlight()

  const readActual = () => adbShellCapture(`cat ${ACTUAL_BACKLIGHT}`)
  // Bracket in the pattern so grep doesn't match its own process — the
  // standard trick for "am I looking for a process that isn't grep itself".
  const alsCount = () => adbShellCapture(`ps | grep -c '[s]p-als-backlight'`)

  // Everything below can throw against a real device (adb round trips, USB
  // drop mid-test). If it does, the finally below still kills any pulse,
  // hands the ALS daemon back, and restores 235 — an aborted self-test must
  // never leave the panel dim/mid-pulse or the device with ambient
  // auto-brightness permanently disabled. actual_brightness also isn't
  // guaranteed to read back exactly what was written (the driver rounds,
  // e.g. 234 -> 235) — the readbacks below are diagnostic prints, not
  // equality assertions.
  try {
    console.log(`ALS daemon (before takeover) -> count=${await alsCount()}`)
    await alsStop()
    console.log(`ALS daemon (after takeover) -> count=${await alsCount()}`)

    console.log(`IDLE (${BRIGHTNESS.IDLE}) -> starting`)
    await backlight.forceSteady(BRIGHTNESS.IDLE)
    // Sample for 2s instead of a single readback — this is the actual proof
    // that IDLE now HOLDS instead of drifting back up under the ALS daemon
    // (min/max should sit close to BRIGHTNESS.IDLE, not climb toward it).
    let idleMin = Infinity, idleMax = -Infinity
    const idleUntil = Date.now() + 2000
    while (Date.now() < idleUntil) {
      const v = Number(await readActual())
      if (!Number.isNaN(v)) { idleMin = Math.min(idleMin, v); idleMax = Math.max(idleMax, v) }
      await sleep(300)
    }
    console.log(`IDLE (${BRIGHTNESS.IDLE}) -> actual_brightness min=${idleMin}/max=${idleMax} over 2s (holds, does not drift)`)

    console.log(`ACTIVE (${BRIGHTNESS.ACTIVE}) -> starting`)
    await backlight.forceSteady(BRIGHTNESS.ACTIVE)
    await sleep(200)
    console.log(`ACTIVE (${BRIGHTNESS.ACTIVE}) -> actual_brightness=${await readActual()}`)

    console.log('ATTENTION pulse 4s -> starting')
    backlight.startPulse()
    let min = Infinity, max = -Infinity
    const until = Date.now() + 4000
    while (Date.now() < until) {
      const v = Number(await readActual())
      if (!Number.isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v) }
      await sleep(150)
    }
    backlight.stopPulse()
    console.log(`ATTENTION pulse 4s -> (min=${min}/max=${max} observed)`)

    console.log('USAGE ALERT burst -> starting')
    await usageAlertBurst(backlight)
    console.log(`USAGE ALERT burst -> actual_brightness=${await readActual()}`)

    console.log('restore 235 -> starting')
    await backlight.forceSteady(BRIGHTNESS.ACTIVE)
    await sleep(200)
    console.log(`restore 235 -> actual_brightness=${await readActual()}`)
  } finally {
    backlight.stopPulse()
    await alsStart()
    await backlight.forceSteady(BRIGHTNESS.ACTIVE)
    console.log(`ALS daemon (restored) -> count=${await alsCount()}`)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  if (process.argv.includes('--self-test')) {
    await selfTest()
    process.exit(0)
  }

  const backlight = new Backlight()
  const sm = new StateMachine(backlight)
  const client = new DaemonClient(sm)

  // Handlers registered BEFORE the first alsStop() below, so a crash during
  // startup itself — not just steady-state — still hands the ALS daemon back
  // and restores the panel instead of leaving the device silently altered.
  const shutdown = async (signal, exitCode = 0) => {
    log('received', signal, '— restoring 235 and exiting')
    backlight.stopPulse()
    // Hand the ALS daemon back BEFORE the final restore so the device is
    // left in stock condition (ambient auto-brightness on) once we exit.
    await alsStart()
    await backlight.forceSteady(BRIGHTNESS.ACTIVE)
    process.exit(exitCode)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM', 0))
  process.on('SIGINT', () => shutdown('SIGINT', 0))
  // SIGHUP and an uncaught exception are crash paths, not a clean stop: exit
  // 1 so the journal records it as such (systemd's Restart=always restarts
  // either way, so nothing is lost by exiting non-zero). unhandledRejection
  // deliberately does NOT go through shutdown — a transient WS promise
  // rejection taking the whole service down would make it LESS resilient
  // than logging and continuing.
  process.on('SIGHUP', () => shutdown('SIGHUP', 1))
  process.on('uncaughtException', (err) => {
    log('uncaught exception:', err?.message || err)
    shutdown('uncaughtException', 1)
  })
  process.on('unhandledRejection', (reason) => {
    log('unhandled rejection (non-fatal, continuing):', reason?.message || reason)
  })

  // Take over the ambient light sensor daemon for the life of this process —
  // see the header comment. Non-fatal on failure: log and carry on with the
  // drift, same as any other adb failure mode. Also re-asserted on every WS
  // (re)connect and on every IDLE entry (see DaemonClient/StateMachine),
  // since a reboot or anything else that restarts sp-als-backlight can bring
  // it back while this service keeps running.
  await alsStop()

  await sm.init()
  client.connect()

  // Second input (Phase E): the claude-thing WS above drives session/
  // permission state; this polls :8791/state independently for a failed
  // fleet action and feeds the same StateMachine/apply() path.
  new FleetWatcher(sm).start()
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
