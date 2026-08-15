'use strict'

const { execFile } = require('node:child_process')
const crypto = require('node:crypto')

// Module-level state
let switching = null        // { id, target, phase, startedAt, budgetMs } or null
let lastResult = null       // { id, ok, ms, error? } or null

// Single-slot pending confirmation -- only one mb.* action can be in flight
// (the existing `switching` guard already forbids concurrent switches), so a
// single pending-confirm slot is sufficient; a second unconfirmed request
// simply replaces it.
let pendingConfirm = null   // { id, token, createdAtMs, used }

const MB_HOST = '192.0.2.10'
const SOURCE_TIMEOUT_MS = 2000
const CONFIRM_TOKEN_TTL_MS = 30_000

// The fleet aggregator -- the ONE producer of fleet state (fleet-state/1).
// See fleet-aggregator/docs/fleet-state-contract.md: "one producer, many consumers.
// Nothing downstream should re-derive fleet state by polling /v1/models
// itself." This service used to duplicate that leaf-inference logic; it now
// only fetches and re-exports the aggregator's document verbatim.
const FLEET_STATE_URL = 'http://localhost:8095/fleet-state.json'
// The aggregator serves a cached snapshot (its own poll cadence is decoupled
// from consumer poll rate -- contract "Endpoint" section), so this fetch
// never blocks on a live probe. Still give it headroom above this service's
// own SOURCE_TIMEOUT_MS (2000ms) -- a client timeout equal to a server's own
// timeout loses the race every time, the exact trap already hit against THIS
// service's own timeout (device/src/deviceInfo.ts:75-86).
const FLEET_STATE_TIMEOUT_MS = 4000

/** llama-server exposes /health; ComfyUI (:8188) has no such route — its 404
 *  read as "not up" forever (observed: pcreate.start verify false-failed at
 *  180s while the UI was serving). Root answers 200 there, so probe that. */
function healthPath(port) {
  return port === 8188 ? '/' : '/health'
}

/** Fetch with a hard timeout via AbortController -- reuses server.js pattern. */
async function fetchWithTimeout(url, ms, init) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

module.exports = {
  readMbState,
  readFleetState,
  readFleetFallback,
  runMbAction,
  __testCompletion: (port) => probeCompletion(port),
}

/**
 * readMbState() → Promise<object>, NEVER throws/rejects.
 * Controller-owned state ONLY (the fleet-state contract §4): the action WE
 * fired (`switching`) and its terminal outcome (`lastResult`). Everything
 * else that used to live here (reachable/profile/workerModel/seniorModel/
 * sideModel/herald/pcreate/seats/leaves/aux) is now the contract's job -- see
 * `readFleetState()` below.
 */
async function readMbState() {
  const sw = switching
  const elapsedMs = sw ? Date.now() - sw.startedAt : undefined
  // pcreate liveness is CONTROLLER-OWNED, not fleet state, and probing it here
  // is NOT the duplication the contract forbids: fleet-state/1 deliberately
  // does not model pcreate at all (it holds no seat and is not a leaf -- see
  // the fleet-state contract §3), so there is no producer-side truth
  // to defer to and no leaf-inference logic being re-derived. We ship a
  // start/stop verb for it, and a verb whose current state is unknowable
  // renders as two blind buttons. Remove this the moment the aggregator grows
  // `commands.services` (the ask in requirements §2.2).
  // Gate is ANY HTTP answer at `/`: ComfyUI has no /health (a 404 there read
  // as "never up" and false-failed a real pcreate.start at 180s).
  const pcreate = await probeAnyHttp(8188)
  return {
    switching: sw ? { id: sw.id, target: sw.target, phase: sw.phase, startedAtMs: sw.startedAt, elapsedMs, budgetMs: sw.budgetMs } : null,
    lastResult,
    pcreate: { up: pcreate, port: 8188, probedAtMs: Date.now() },
  }
}

/** ANY HTTP answer counts as up -- see the pcreate note in readMbState. */
async function probeAnyHttp(port) {
  try {
    await fetchWithTimeout(`http://${MB_HOST}:${port}/`, SOURCE_TIMEOUT_MS)
    return true
  } catch (_) {
    return false
  }
}

/**
 * readFleetState() → Promise<{ doc, error }>, NEVER throws/rejects.
 * `doc` is the fleet-state/1 document VERBATIM (unknown keys untouched --
 * contract law 7, additive evolution) when the aggregator answered with a
 * valid JSON object; otherwise `doc` is null and `error` names the reason.
 * No fallback to probing fleet-host directly if this fails -- that would
 * resurrect the duplicate leaf-inference logic the contract forbids.
 */
async function readFleetState() {
  try {
    const res = await fetchWithTimeout(FLEET_STATE_URL, FLEET_STATE_TIMEOUT_MS)
    if (!res.ok) return { doc: null, error: `http ${res.status}` }
    let body
    try {
      body = await res.json()
    } catch (err) {
      return { doc: null, error: `invalid JSON: ${String(err?.message ?? err)}` }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { doc: null, error: 'response was not a JSON object' }
    }
    return { doc: body, error: null }
  } catch (err) {
    return { doc: null, error: String(err?.message ?? err) }
  }
}

// Seats probed by readFleetFallback() -- occupancy only, ids/ports match
// fleet-aggregator's own contract (worker :8081, senior :8080), never a leaf/profile name.
const FALLBACK_SEATS = [
  { id: 'worker', port: 8081 },
  { id: 'senior', port: 8080 },
]

/**
 * readFleetFallback(doc) -> Promise<{ probedAtMs, seats } | null>, NEVER
 * throws/rejects. Called with the SAME `doc` readFleetState() just returned;
 * a non-null `doc` means the aggregator is up, so this returns null and
 * issues NO probe at all (zero added load on the happy path).
 *
 * When the aggregator is down, this is a narrow availability fallback --
 * seat occupancy ONLY. It does not infer, derive, or guess a leaf/profile
 * name from the occupant string; that substring-matching logic was
 * deliberately deleted (see the removal note at the bottom of this file) and
 * stays fleet-aggregator's job alone (fleet-aggregator/tools/fleet_probe.py). Each seat's occupant is
 * whatever `/v1/models`'s `models[0].name` reports, verbatim.
 */
async function readFleetFallback(doc) {
  if (doc) return null
  const results = await Promise.allSettled(FALLBACK_SEATS.map((s) => probeSeatOccupant(s.port)))
  return {
    probedAtMs: Date.now(),
    seats: FALLBACK_SEATS.map((s, i) => {
      const r = results[i]
      // reachable/occupant are independent: a live server with an empty
      // `models` array is `up:true, occupant:null` (a genuinely empty seat),
      // never collapsed into the same false as a seat we couldn't reach at
      // all -- fleet-aggregator's own contract distinguishes empty/loading/unreachable.
      const probe = r.status === 'fulfilled' ? r.value : { reachable: false, occupant: null }
      return { id: s.id, port: s.port, up: probe.reachable, occupant: probe.occupant }
    }),
  }
}

/** Raw /v1/models probe for one seat -- `reachable` is true iff the fetch
 *  returned 200 with parseable JSON (independent of whether a model is
 *  loaded); `occupant` is `models[0].name` EXACTLY as the server reports it,
 *  or null when the seat answered but is empty. Never parsed/mapped to a
 *  leaf name. */
async function probeSeatOccupant(port) {
  try {
    const res = await fetchWithTimeout(`http://${MB_HOST}:${port}/v1/models`, SOURCE_TIMEOUT_MS)
    if (!res.ok) return { reachable: false, occupant: null }
    const body = await res.json()
    const name = body?.models?.[0]?.name
    return { reachable: true, occupant: typeof name === 'string' && name ? name : null }
  } catch (_) {
    return { reachable: false, occupant: null }
  }
}

/**
 * runMbAction(id, opts) → Promise<object>.
 *
 * Two-step confirm (owner requirement, prompted by a real incident: a
 * dry-run env var set on a `curl` invocation instead of the service's own
 * environment never reached the server process, and a real leaf flip ran
 * against a box under load):
 *
 *   1. POST {id}                -> does NOT execute. Returns a short-lived
 *      (30s), single-use `confirm_token` bound to this id, plus `would` (the
 *      command that WOULD run).
 *   2. POST {id, confirm_token} -> executes iff the token matches, is
 *      unexpired, unused, and bound to this exact id. Otherwise rejected.
 *
 * `dry_run: true` in the request payload is the honest per-request
 * mechanism: it echoes `would` and executes nothing, independent of (and in
 * addition to) the CARTHING_ACTION_DRYRUN env-var kill-switch server.js
 * still checks first. An env var on the CLIENT (e.g. a `curl` invocation) is
 * meaningless here -- only the payload flag or the SERVICE PROCESS's own
 * environment can suppress execution.
 */
async function runMbAction(id, opts = {}) {
  const ACTION_ALLOWLIST = {
    'mb.profile.chat':    { cmd: 'cd ~ && ./profile.sh chat',    ports: [8081], verifyType: 'completion' },
    'mb.profile.prod':    { cmd: 'cd ~ && ./profile.sh prod',    ports: [8081], verifyType: 'completion' },
    'mb.profile.swarm':   { cmd: 'cd ~ && ./profile.sh swarm',   ports: [8081], verifyType: 'completion' },
    'mb.profile.pair':    { cmd: 'cd ~ && ./profile.sh pair',    ports: [8081], verifyType: 'completion' },
    'mb.profile.leaf-deep':   { cmd: 'cd ~ && ./profile.sh leaf-deep',   ports: [8080], verifyType: 'completion' },
    'mb.profile.leaf-mid':     { cmd: 'cd ~ && ./profile.sh leaf-mid',     ports: [8081], verifyType: 'completion' },
    'mb.profile.leaf-alt':    { cmd: 'cd ~ && ./profile.sh leaf-alt',    ports: [8081], verifyType: 'completion' },
    'mb.herald.summon':   { cmd: 'cd ~ && ./profile.sh herald',  ports: [8080], verifyType: 'completion' },
    'mb.herald.dismiss':  { cmd: 'systemctl --user stop senior-herald', ports: [8080], verifyType: 'down' },
    'mb.pcreate.start':   { cmd: 'cd ~ && ./pcreate.sh start',   ports: [8188], verifyType: 'up' },
    'mb.pcreate.stop':    { cmd: 'cd ~ && ./pcreate.sh stop',    ports: [8188], verifyType: 'down' },
  }

  const entry = ACTION_ALLOWLIST[id]
  if (!entry) return { error: `unknown action id: ${id}` }

  if (switching) return { error: `switch in progress: ${switching.id}` }

  // Determine target (leaf verb)
  const target = id.startsWith('mb.profile.')
    ? id.slice('mb.profile.'.length)
    : id.startsWith('mb.herald.')
      ? id.slice('mb.herald.'.length)
      : id.startsWith('mb.pcreate.')
        ? id.slice('mb.pcreate.'.length)
        : id

  const would = { id, target, cmd: entry.cmd, ports: entry.ports, verifyType: entry.verifyType }

  if (opts.dry_run === true) {
    console.log(`[action] ${new Date().toISOString()} id=${id} exit=DRYRUN-payload (not spawned)`)
    return { id, target, dry_run: true, would }
  }

  if (!opts.confirm_token) {
    const token = issueConfirmToken(id)
    console.log(`[action] ${new Date().toISOString()} id=${id} exit=confirm-issued (not spawned)`)
    return { id, target, confirm_token: token, expires_in_s: CONFIRM_TOKEN_TTL_MS / 1000, would }
  }

  const check = validateConfirmToken(id, opts.confirm_token)
  if (!check.ok) {
    console.log(`[action] ${new Date().toISOString()} id=${id} exit=confirm-rejected(${check.reason})`)
    return { error: `confirm_token rejected: ${check.reason}` }
  }
  pendingConfirm.used = true

  switching = { id, target, phase: 'launch', startedAt: Date.now(), budgetMs: computeBudgetMs(id, entry) }

  const argv = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'fleet-host', entry.cmd]

  // Fire-and-forget spawn
  execFile('ssh', argv, { timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
    if (err) console.error(`[mb] ssh error for ${id}: ${err?.message ?? err}`)
  })

  // Start the async verify loop
  runVerify(id, entry, target).catch(() => {})

  return { id, target }
}

/** Issue a fresh single-use confirm token bound to `id`, replacing any prior
 *  pending confirmation (only one mb.* action can legitimately be pending
 *  confirmation at a time -- `switching` already forbids concurrent flips). */
function issueConfirmToken(id) {
  const token = crypto.randomBytes(16).toString('hex')
  pendingConfirm = { id, token, createdAtMs: Date.now(), used: false }
  return token
}

/** Reject reasons are deliberately specific (expired / reused / wrong id /
 *  mismatch / none pending) -- an operator debugging a rejected flip needs
 *  to know WHICH invariant broke. */
function validateConfirmToken(id, token) {
  if (!pendingConfirm) return { ok: false, reason: 'no pending confirmation' }
  if (pendingConfirm.used) return { ok: false, reason: 'confirm_token already used' }
  if (Date.now() - pendingConfirm.createdAtMs > CONFIRM_TOKEN_TTL_MS) return { ok: false, reason: 'confirm_token expired' }
  if (pendingConfirm.id !== id) return { ok: false, reason: 'confirm_token bound to a different action id' }
  if (pendingConfirm.token !== token) return { ok: false, reason: 'confirm_token mismatch' }
  return { ok: true }
}

/** The up-budget actually in force for a given action -- mirrors the budgets
 *  already hardcoded per-branch in runVerify (90s herald.summon, 180s other
 *  completion/up flips, 60s down-verify), computed once at switch-start so
 *  the device can draw progress against the real number instead of an
 *  invented one. */
function computeBudgetMs(id, entry) {
  if (entry.verifyType === 'down') return 60000
  if (entry.verifyType === 'completion') return id === 'mb.herald.summon' ? 90000 : 180000
  return 180000 // 'up'
}

/** Log a verify-start line matching server.js logAction format. */
function logVerifyStart(id, entry) {
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'fleet-host', entry.cmd]
  console.log(`[action] ${new Date().toISOString()} id=${id} argv=[${sshArgs.join(', ')}] exit=verify-start`)
}

/** Terminal log matching server.js logAction format. */
function logVerifyTerminal(id, entry, logExit) {
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'fleet-host', entry.cmd]
  console.log(`[action] ${new Date().toISOString()} id=${id} argv=[${sshArgs.join(', ')}] exit=${logExit}`)
}

// ---------------------------------------------------------------------------
// Verify helpers
// ---------------------------------------------------------------------------

async function runVerify(id, entry, target) {
  logVerifyStart(id, entry)
  const totalStart = Date.now()
  let ok = false
  let error

  try {
    if (entry.verifyType === 'up') {
      // Grace period: first health poll must outlive stop_all's teardown or it
      // passes against the outgoing server (observed on hardware 2026-08-13, first live flip).
      switching && (switching.phase = 'launch')
      await sleep(10000)
      const budgetMs = 180000
      ok = await verifyUp(id, entry.ports[0], totalStart, budgetMs)
      if (!ok) error = `health 200 not reached in ${budgetMs / 1000}s`
    } else if (entry.verifyType === 'down') {
      const budgetMs = 60000
      ok = await verifyDown(id, entry.ports[0], totalStart, budgetMs)
      if (!ok) error = `port ${entry.ports[0]} still answering after ${budgetMs / 1000}s`
    } else if (entry.verifyType === 'completion') {
      // Grace period: first health poll must outlive stop_all's teardown or it
      // passes against the outgoing server (observed on hardware 2026-08-13, first live flip).
      switching && (switching.phase = 'launch')
      await sleep(10000)
      // up phase (budget: 180s normally, 90s for herald.summon; grace counts against it)
      const upBudget = (id === 'mb.herald.summon') ? 90000 : 180000
      const up = await verifyUp(id, entry.ports[0], totalStart, upBudget)
      if (!up) {
        // health never came back — completion phase would just spin against a dead port
        error = `health 200 not reached in ${upBudget / 1000}s`
      } else {
        const compStart = Date.now()
        ok = await verifyCompletion(id, entry.ports[0], compStart)
        if (!ok) error = 'no real completion (timings.predicted_n <= 0)'
      }
    }
  } catch (err) {
    ok = false
    error = err?.message ?? String(err)
  } finally {
    const totalMs = Date.now() - totalStart
    lastResult = ok ? { id, ok, ms: totalMs } : { id, ok, ms: totalMs, error }
    logVerifyTerminal(id, entry, ok ? `verify-ok(${totalMs / 1000 | 0}s)` : `verify-failed(${error})`)
    switching = null
  }
}

async function verifyUp(id, port, totalStart, budgetMs) {
  if (!budgetMs) budgetMs = 180000
  const deadline = totalStart + budgetMs
  switching && (switching.phase = 'health')
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(`http://${MB_HOST}:${port}${healthPath(port)}`, SOURCE_TIMEOUT_MS)
      if (res.ok) return true  // up achieved
    } catch (_) {
      // timeout or network error — keep polling
    }
    await sleep(5000)
  }
  return false  // budget exhausted without 200
}

/** One completion probe: POST a real chat request, true iff the server actually generated tokens. */
async function probeCompletion(port) {
  try {
    const res = await fetchWithTimeout(`http://${MB_HOST}:${port}/v1/chat/completions`, 60000, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Say READY' }], max_tokens: 200 }),
    })
    if (!res.ok) return false
    const body = await res.json()
    return body?.timings?.predicted_n > 0
  } catch (_) {
    return false
  }
}

async function verifyCompletion(id, port, compStart) {
  switching && (switching.phase = 'completion')

  // First attempt
  if (await probeCompletion(port)) return true

  // Two retries after 5s each — gpt-oss-120b's cold load can leave the first
  // post-200 completion slow; each attempt is bounded by its own 60s fetch timeout.
  await sleep(5000)
  if (await probeCompletion(port)) return true

  await sleep(5000)
  return await probeCompletion(port)
}

async function verifyDown(id, port, totalStart, budgetMs) {
  if (!budgetMs) budgetMs = 60000
  const deadline = totalStart + budgetMs
  let consecutiveFailures = 0
  switching && (switching.phase = 'down')

  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(`http://${MB_HOST}:${port}${healthPath(port)}`, SOURCE_TIMEOUT_MS)
      if (res.ok) {
        consecutiveFailures = 0  // reset on any success
      } else {
        consecutiveFailures++
      }
    } catch (_) {
      // connection refused or timeout
      consecutiveFailures++
    }

    if (consecutiveFailures >= 2) return true  // down achieved

    await sleep(5000)
  }
  return false  // budget exhausted, port still answering
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Leaf fingerprinting (heretic/qwen38-27b/gemma/Ornith substring matching),
// occupantShort(), LEAF_META, and the invented seats/leaves/aux blocks that
// used to live here have been REMOVED -- that was this service duplicating
// the leaf-inference logic that fleet-state/1's producer already owns
// (fleet-aggregator/docs/fleet-state-contract.md: "one producer, many consumers").
// See readFleetState() above for the replacement.
