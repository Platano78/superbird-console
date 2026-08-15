#!/usr/bin/env node
// Rotary dial -> ArrowUp/ArrowDown bridge for the Car Thing.
//
// The rotary encoder (`rotary@0`, /dev/input/event1) has no `kbd` handler, so
// Chromium never sees its rotation as a key event — no listener, polyfill, or
// JS-side trick can read it from the web app (see
// docs/solutions/gotchas/rotary-dial-unreadable-and-why-the-bridge-cannot-live-on-the-device-2026-08-15.md).
// The device rootfs also ships no Node, no Python — only busybox, wget, curl,
// nc, telnet — so nothing we write can execute ON the device. This service is
// entirely host-side, same idiom as scripts/backlight-daemon.mjs: a bounded
// device-side busybox decoder emits one text line per event over an `adb
// shell` PTY, and this process turns the ones that matter into synthesized
// key events delivered via Chrome DevTools Protocol on the kiosk's already-
// open --remote-debugging-port=2222 (adb forward tcp:9222 tcp:2222).
//
// Transport note (same as backlight-daemon.mjs): `adb shell -T` (no-PTY)
// fails on this device, so every adb shell gets a PTY that echoes stdin back
// on stdout. The decoder child is therefore spawned with stdin IGNORED
// (never fed) — a stdin-fed shell here would eventually deadlock on an
// undrained pipe.
//
// Node has global fetch and global WebSocket (stable since 22.4) — zero npm
// dependencies.

import { spawn } from 'node:child_process'

// ADB must be the WINDOWS binary — see scripts/keep-adb-reverse.sh.
const ADB = '/mnt/c/Users/YOURUSER/AppData/Local/Programs/deskthing/resources/win/adb.exe'
// ⚠ ALWAYS address the Car Thing by serial. A bare `adb shell`/`adb forward`
// fails outright the moment any second device is attached — see
// scripts/backlight-daemon.mjs header, took production down 2026-08-02.
const SERIAL = process.env.CAR_THING_SERIAL || 'DEVICESERIAL'
const ADB_ARGS = ['-s', SERIAL]

const DEVICE_EVENT = '/dev/input/event1' // rotary@0 — verified 2026-08-15, see gotcha doc
// hexdump decodes the 16-byte input_event record (32-bit time_t, LE) into one
// text line per event: "tv_sec tv_usec type code value". Raw bytes can never
// be streamed over the adb PTY (it mangles binary) — text, one line per
// event, is the only shape that survives the transport.
const HEXDUMP_FMT = '1/4 "%u " 1/4 "%u " 1/2 "%u " 1/2 "%u " 1/4 "%d " "\\n"'
const DECODE_CMD = `hexdump -v -e '${HEXDUMP_FMT}' ${DEVICE_EVENT}`

const EV_REL = 2
const REL_HWHEEL = 6

// 🔴 Direction sign is PROBABLE, not proven (see gotcha doc) — the capture
// opened with +1 while clockwise was asked for first, but nobody watched the
// hand. Kept as ONE named constant so the sign is a one-character fix, never
// a redesign. Keyed by String(value) since `value` arrives as a JS number
// that can be -1.
const DIR = { '1': 'ArrowDown', '-1': 'ArrowUp' }

// 🔴 CONTAINMENT LAW — this bridge may dispatch ONLY ArrowUp/ArrowDown, never
// Enter, never Digit1-Digit4, never anything else. Those keys answer Claude
// Code permission prompts on this device; a bridge bug must never be able to
// synthesise a permission answer. Enforced structurally: this is a hardcoded
// two-entry map, not a pass-through, and dispatchArrow() below only accepts
// the two literal keys of this object — there is no code path that can turn
// arbitrary decoder input into an arbitrary key event.
const KEY_EVENTS = {
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
}

const CDP_LOCAL_PORT = 9222
const CDP_DEVICE_PORT = 2222
const RETRY_MS = 3000

const log = (...args) => console.log(new Date().toISOString(), ...args)
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

/** Run one `adb <args>`, ignore stdout/stderr, resolve/reject on exit. Mirrors backlight-daemon.mjs's adbShell(). */
function adbRun(args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ADB, [...ADB_ARGS, ...args], { stdio: ['ignore', 'ignore', 'ignore'] })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('adb timed out: ' + args.join(' '))) }, timeoutMs)
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve() : reject(new Error('adb exited ' + code + ': ' + args.join(' ')))
    })
  })
}

/** Re-asserts the CDP tunnel. Idempotent — keep-adb-reverse.sh already does this every 30s, this just guarantees it before we depend on it. */
async function ensureForward() {
  await adbRun(['forward', `tcp:${CDP_LOCAL_PORT}`, `tcp:${CDP_DEVICE_PORT}`])
  log('adb forward tcp:' + CDP_LOCAL_PORT + ' -> tcp:' + CDP_DEVICE_PORT + ' established')
}

/**
 * Parses one hexdump text line into { type, code, value }, or null if the
 * line is malformed. Never fatal — a bad line is skipped, not thrown.
 */
function parseLine(line) {
  const fields = line.trim().split(/\s+/).filter(Boolean)
  if (fields.length < 5) return null
  const type = Number(fields[2])
  const code = Number(fields[3])
  const value = Number(fields[4])
  if (!Number.isFinite(type) || !Number.isFinite(code) || !Number.isFinite(value)) return null
  return { type, code, value }
}

/** type=EV_REL/code=REL_HWHEEL only; everything else (EV_SYN, anything unrecognized) is ignored. Returns 'ArrowUp'|'ArrowDown'|null. */
function directionFor(event) {
  if (!event || event.type !== EV_REL || event.code !== REL_HWHEEL) return null
  return DIR[String(event.value)] || null
}

/** Re-resolves the kiosk page's webSocketDebuggerUrl — never cached across reconnects, since `supervisorctl restart chromium` is a normal deploy step that invalidates it. */
async function resolvePageTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_LOCAL_PORT}/json/list`)
  if (!res.ok) throw new Error('CDP /json/list HTTP ' + res.status)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('no CDP page target found')
  log('CDP target resolved:', page.url || page.id)
  return page.webSocketDebuggerUrl
}

/** Thin CDP client: request/reply correlation over one WebSocket, same shape as DaemonClient in backlight-daemon.mjs. */
class CdpClient {
  #ws
  #nextId = 0
  #pending = new Map()

  constructor(ws) {
    this.#ws = ws
    ws.onmessage = (e) => this.#onFrame(String(e.data))
  }

  #onFrame(raw) {
    let m
    try { m = JSON.parse(raw) } catch { return }
    const fn = typeof m.id === 'number' && this.#pending.get(m.id)
    if (!fn) return
    this.#pending.delete(m.id)
    fn(m.result, m.error)
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.#ws.readyState !== 1) return reject(new Error('CDP socket not open'))
      const id = ++this.#nextId
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(method + ' timed out')) }, 5000)
      this.#pending.set(id, (result, error) => {
        clearTimeout(timer)
        error ? reject(new Error(error.message || 'CDP error')) : resolve(result)
      })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

/**
 * Dispatches exactly one detent as rawKeyDown then keyUp. `dir` must be one
 * of the two literal keys of KEY_EVENTS (see containment law comment above) —
 * anything else is a no-op, never a dispatch.
 */
async function dispatchArrow(cdp, dir) {
  const info = KEY_EVENTS[dir]
  if (!info) return
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...info })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...info })
  log('dispatched', dir)
}

/**
 * Opens the CDP WebSocket and runs one session: spawns the device-side
 * decoder, wires its text lines to dispatchArrow(), and resolves once either
 * side (CDP socket or decoder process) ends — so the caller's retry loop can
 * re-resolve a fresh page target and respawn a fresh decoder next time.
 */
function runSession(wsUrl) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (reason) => {
      if (settled) return
      settled = true
      try { decoder.kill('SIGKILL') } catch { /* already gone */ }
      try { ws.close() } catch { /* already closed */ }
      resolve(reason)
    }

    const ws = new WebSocket(wsUrl)
    const cdp = new CdpClient(ws)

    ws.onopen = () => log('CDP socket open')
    ws.onerror = (e) => log('CDP socket error:', e?.message || e)
    ws.onclose = () => finish('cdp closed')

    const decoder = spawn(ADB, [...ADB_ARGS, 'shell', DECODE_CMD], { stdio: ['ignore', 'pipe', 'pipe'] })
    log('decoder spawned (pid', decoder.pid, ')')
    let buf = ''
    decoder.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() // keep the trailing partial line for the next chunk
      for (const line of lines) {
        const event = parseLine(line)
        const dir = directionFor(event)
        if (dir) dispatchArrow(cdp, dir).catch((err) => log('dispatch failed:', err.message))
      }
    })
    decoder.on('error', (err) => { log('decoder spawn failed:', err.message); finish('decoder error') })
    decoder.on('exit', (code) => { log('decoder exited', code); finish('decoder exit') })
  })
}

let stopping = false

async function main() {
  log('rotary bridge starting — serial', SERIAL)
  process.on('SIGTERM', () => { log('received SIGTERM — shutting down'); stopping = true })
  process.on('SIGINT', () => { log('received SIGINT — shutting down'); stopping = true })
  process.on('uncaughtException', (err) => log('uncaught exception (non-fatal, continuing):', err?.message || err))
  process.on('unhandledRejection', (reason) => log('unhandled rejection (non-fatal, continuing):', reason?.message || reason))

  while (!stopping) {
    try {
      await ensureForward()
      const wsUrl = await resolvePageTarget()
      const reason = await runSession(wsUrl)
      log('session ended:', reason)
    } catch (err) {
      log('session failed:', err.message)
    }
    if (stopping) break
    await sleep(RETRY_MS)
  }
  log('shut down cleanly')
  process.exit(0)
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
