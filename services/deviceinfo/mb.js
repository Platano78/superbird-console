'use strict'

const { execFile } = require('node:child_process')

// Module-level state
let switching = null        // { id, target, phase, startedAt, budgetMs } or null
let lastResult = null       // { id, ok, ms, error? } or null

const MB_HOST = '192.0.2.10'
const SOURCE_TIMEOUT_MS = 2000

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

module.exports = { readMbState, runMbAction, __testCompletion: (port) => probeCompletion(port) }

/**
 * readMbState() → Promise<object>, NEVER throws/rejects.
 * Runs 7 probes in parallel (2 seats + 1 swarm side-model + 4 aux lanes),
 * each with a 2000ms AbortController timeout.
 */
async function readMbState() {
  const [wRes, sRes, sidRes, auxFlmRes, auxTtsRes, auxPyRes, auxPcreateRes] = await Promise.allSettled([
    probeModels(8081),
    probeModels(8080),
    probeModels(8082),
    probeAux(8091),
    probeAux(8092),
    probeAux(8093),
    probeAux(8188),
  ])

  const rejectedProbe = { up: false, id: null, error: 'probe rejected', probedAtMs: Date.now() }
  const rejectedAux = { up: false, probedAtMs: Date.now() }
  const worker = wRes.status === 'fulfilled' ? wRes.value : rejectedProbe
  const senior = sRes.status === 'fulfilled' ? sRes.value : rejectedProbe
  const side = sidRes.status === 'fulfilled' ? sidRes.value : rejectedProbe
  const auxFlm = auxFlmRes.status === 'fulfilled' ? auxFlmRes.value : rejectedAux
  const auxTts = auxTtsRes.status === 'fulfilled' ? auxTtsRes.value : rejectedAux
  const auxPy = auxPyRes.status === 'fulfilled' ? auxPyRes.value : rejectedAux
  const auxPcreate = auxPcreateRes.status === 'fulfilled' ? auxPcreateRes.value : rejectedAux

  const workerModel = worker.id
  const seniorModel = senior.id
  const sideModel = side.id
  const pcreate = auxPcreate.up

  const reachable = workerModel !== null || seniorModel !== null

  // Profile rules (substring tests on model id)
  // ⚠ TWO consumers of this truth table: this file and fleet-aggregator's mb-ensure.sh
  //   current_leaf(). A fingerprint change here needs the same edit there
  //   (route-backend.sh is immune — it routes by seat, never by model name).
  // ⚠ swarm detection must match Ornith SPECIFICALLY on 8082, never mere port-presence.
  // ⚠ chat RESEATED 2026-08-14: it is now Gemma-4-26B on the WORKER seat (:8081) +
  //   gpt-oss-120b on the SENIOR seat (:8080), and no longer uses :8082 at all. This test
  //   used to key on gpt-oss@:8081 and silently reported "no profile" after the reseat.
  //   swarm's Gemma sits on :8083, so 26B-on-:8081 is unique to chat.
  let profile = null
  if (workerModel) {
    if (workerModel.includes('gemma-4-26B') || workerModel.includes('gemma4-26b')) profile = 'chat'
    else if (workerModel.includes('qwen36-35b') || workerModel.includes('Qwen3.6-35B')) {
      profile = sideModel && sideModel.includes('Ornith') ? 'swarm' : 'prod'
    }
    else if (workerModel.includes('Ornith')) profile = 'pair'
    // 🔴 ORDERING TRAP -- q38h's model path ("/models/qwen38-27b-heretic/
    // Qwen3.8-27B-heretic-ara.i1-Q6_K.gguf") CONTAINS both of q38's unique
    // substrings ("qwen38-27b" AND "Qwen3.8-27B"). `heretic` MUST be tested
    // BEFORE either q38 substring or the uncensored leaf silently reports as
    // the stock one. Do not reorder these two branches.
    else if (workerModel.includes('heretic')) profile = 'q38h'
    else if (workerModel.includes('qwen38-27b') || workerModel.includes('Qwen3.8-27B')) profile = 'q38'
  }
  if (profile === null && workerModel === null && seniorModel && seniorModel.includes('DeepSeek-V4-Flash')) {
    profile = 'dsv4f'
  }

  const herald = seniorModel ? seniorModel.includes('Qwen3.5-122B') : false

  const sw = switching
  const elapsedMs = sw ? Date.now() - sw.startedAt : undefined

  const seats = [
    { seat: 'worker', port: 8081, up: worker.up, occupant: workerModel, occupantShort: occupantShort(workerModel), probedAtMs: worker.probedAtMs, error: worker.error },
    { seat: 'senior', port: 8080, up: senior.up, occupant: seniorModel, occupantShort: occupantShort(seniorModel), probedAtMs: senior.probedAtMs, error: senior.error },
  ]

  const leaves = Object.entries(LEAF_META).map(([id, meta]) => ({
    id, active: profile === id, tier: meta.tier, flags: meta.flags, seats: meta.seats,
  }))

  const aux = [
    { id: 'flm-real', port: 8091, up: auxFlm.up, probedAtMs: auxFlm.probedAtMs },
    { id: 'tts-server', port: 8092, up: auxTts.up, probedAtMs: auxTts.probedAtMs },
    { id: 'py', port: 8093, up: auxPy.up, probedAtMs: auxPy.probedAtMs },
    { id: 'pcreate', port: 8188, up: auxPcreate.up, probedAtMs: auxPcreate.probedAtMs },
  ]

  return {
    reachable,
    profile,
    workerModel,
    seniorModel,
    sideModel,
    herald,
    pcreate,
    seats,
    leaves,
    aux,
    switching: sw ? { id: sw.id, target: sw.target, phase: sw.phase, startedAtMs: sw.startedAt, elapsedMs, budgetMs: sw.budgetMs } : null,
    lastResult,
  }
}

/**
 * runMbAction(id) → Promise<{id,target}|{error}>.
 */
async function runMbAction(id) {
  const ACTION_ALLOWLIST = {
    'mb.profile.chat':    { cmd: 'cd ~ && ./profile.sh chat',    ports: [8081], verifyType: 'completion' },
    'mb.profile.prod':    { cmd: 'cd ~ && ./profile.sh prod',    ports: [8081], verifyType: 'completion' },
    'mb.profile.swarm':   { cmd: 'cd ~ && ./profile.sh swarm',   ports: [8081], verifyType: 'completion' },
    'mb.profile.pair':    { cmd: 'cd ~ && ./profile.sh pair',    ports: [8081], verifyType: 'completion' },
    'mb.profile.dsv4f':   { cmd: 'cd ~ && ./profile.sh dsv4f',   ports: [8080], verifyType: 'completion' },
    'mb.profile.q38':     { cmd: 'cd ~ && ./profile.sh q38',     ports: [8081], verifyType: 'completion' },
    'mb.profile.q38h':    { cmd: 'cd ~ && ./profile.sh q38h',    ports: [8081], verifyType: 'completion' },
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

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** `up` is the HTTP-answered flag, kept separate from `id` -- a seat can
 *  answer 200 with an empty roster, and that is still "up" (per
 *  the fleet-state contract §2: not inferrable from occupant===null). */
async function probeModels(port) {
  try {
    const res = await fetchWithTimeout(`http://${MB_HOST}:${port}/v1/models`, SOURCE_TIMEOUT_MS)
    const probedAtMs = Date.now()
    if (!res.ok) return { up: false, id: null, error: `http ${res.status}`, probedAtMs }
    const body = await res.json()
    const data = Array.isArray(body?.data) ? body.data : []
    return { up: true, id: data[0]?.id ?? null, error: null, probedAtMs }
  } catch (err) {
    return { up: false, id: null, error: String(err?.message ?? err), probedAtMs: Date.now() }
  }
}

/** Aux-lane liveness -- ANY HTTP answer counts (same gate the pcreate probe
 *  always used: ComfyUI has no /health and a 404 there previously read as
 *  "never up", false-failing a real pcreate.start). Read-only lanes only. */
async function probeAux(port) {
  try {
    await fetchWithTimeout(`http://${MB_HOST}:${port}/`, SOURCE_TIMEOUT_MS)
    return { up: true, probedAtMs: Date.now() }
  } catch (_) {
    return { up: false, probedAtMs: Date.now() }
  }
}

/** Server-computed display name for a seat occupant, <=12 chars, uppercase.
 *  Extends device/src/components/MbSlot.tsx's seniorShort() to both seats
 *  and drops its herald-suppression special case -- that suppression is a
 *  UI concern (device/src/components/fleet decides what to hide); the
 *  server reports the truth. */
function occupantShort(m) {
  if (!m) return null
  if (m.includes('gpt-oss-120b')) return '120B'
  if (m.includes('DeepSeek-V4-Flash')) return 'DSV4F'
  if (m.includes('Qwen3.5-122B')) return '122B'
  if (m.includes('gemma-4-26B') || m.includes('gemma4-26b')) return 'GEMMA26B'
  if (m.includes('Ornith')) return 'ORNITH9B'
  // ⚠ Same ordering trap as the profile chain in readMbState above --
  // heretic's path contains the stock substring, so it must be tested first.
  if (m.includes('heretic')) return 'Q38H'
  if (m.includes('qwen38-27b') || m.includes('Qwen3.8-27B')) return 'Q38'
  if (m.includes('qwen36-35b') || m.includes('Qwen3.6-35B')) return 'Q35-35B'
  const base = m.split('/').pop() ?? m
  return base.replace(/\.gguf$/, '').slice(0, 12).toUpperCase()
}

// Leaf roster metadata -- tier/flags/seats are static per leaf; `active` is
// derived once from the SAME fingerprint chain that sets `profile` (see
// readMbState) so there is exactly one source of truth for "what's running".
const LEAF_META = {
  chat:  { tier: 'daily',          flags: [],              seats: ['worker', 'senior'] },
  prod:  { tier: 'daily',          flags: [],              seats: ['worker'] },
  // pair reseats BOTH seats: Ornith-9B @:8081 AND DSV4F @:8080 (profile.sh
  // "P-PAIR: Ornith-9B fast lane @:8081 + DSV4F senior @:8080").
  pair:  { tier: 'daily',          flags: [],              seats: ['worker', 'senior'] },
  swarm: { tier: 'daily',          flags: [],              seats: ['worker'] },
  dsv4f: { tier: 'daily',          flags: [],              seats: ['senior'] },
  q38:   { tier: 'ready-for-duty', flags: [],              seats: ['worker'] },
  q38h:  { tier: 'ready-for-duty', flags: ['uncensored'],  seats: ['worker'] },
}
