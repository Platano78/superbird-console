'use strict'

const { execFile } = require('node:child_process')

// Module-level state
let switching = null        // { id, target, phase, startedAt } or null
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
 * Runs 3 probes in parallel, each with a 2000ms AbortController timeout.
 */
async function readMbState() {
  const [wRes, sRes, pRes] = await Promise.allSettled([
    probeModels(8081),
    probeModels(8080),
    probePcreate(),
  ])

  const workerModel = wRes.status === 'fulfilled' ? wRes.value : null
  const seniorModel = sRes.status === 'fulfilled' ? sRes.value : null
  const pcreate = pRes.status === 'fulfilled' && pRes.value

  const reachable = workerModel !== null || seniorModel !== null

  // Profile rules (substring tests on model id)
  let profile = null
  if (workerModel) {
    if (workerModel.includes('gpt-oss-120b')) profile = 'chat'
    else if (workerModel.includes('qwen36-35b') || workerModel.includes('Qwen3.6-35B')) profile = 'prod'
    else if (workerModel.includes('Ornith')) profile = 'pair'
  }
  if (profile === null && workerModel === null && seniorModel && seniorModel.includes('DeepSeek-V4-Flash')) {
    profile = 'dsv4f'
  }

  const herald = seniorModel ? seniorModel.includes('Qwen3.5-122B') : false

  const sw = switching
  const elapsedMs = sw ? Date.now() - sw.startedAt : undefined

  return {
    reachable,
    profile,
    workerModel,
    seniorModel,
    herald,
    pcreate,
    switching: sw ? { id: sw.id, target: sw.target, phase: sw.phase, elapsedMs } : null,
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
    'mb.profile.pair':    { cmd: 'cd ~ && ./profile.sh pair',    ports: [8081], verifyType: 'completion' },
    'mb.profile.dsv4f':   { cmd: 'cd ~ && ./profile.sh dsv4f',   ports: [8080], verifyType: 'completion' },
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

  switching = { id, target, phase: 'launch', startedAt: Date.now() }

  const argv = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'fleet-host', entry.cmd]

  // Fire-and-forget spawn
  execFile('ssh', argv, { timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (err) => {
    if (err) console.error(`[mb] ssh error for ${id}: ${err?.message ?? err}`)
  })

  // Start the async verify loop
  runVerify(id, entry, target).catch(() => {})

  return { id, target }
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

async function probeModels(port) {
  try {
    const res = await fetchWithTimeout(`http://${MB_HOST}:${port}/v1/models`, SOURCE_TIMEOUT_MS)
    if (!res.ok) return null
    const body = await res.json()
    const data = Array.isArray(body?.data) ? body.data : []
    return data[0]?.id ?? null
  } catch (_) {
    return null
  }
}

async function probePcreate() {
  try {
    await fetchWithTimeout(`http://${MB_HOST}:8188/`, SOURCE_TIMEOUT_MS)
    return true
  } catch (_) {
    return false
  }
}
