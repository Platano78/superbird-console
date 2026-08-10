// Read-only device-info service for the Car Thing dashboard.
//
// Plain Node, zero npm dependencies (node:http / node:fs / node:child_process
// / global fetch only). Listens on 127.0.0.1:8791. Two endpoints:
//   GET /state  -> { fleet, queue, system, ts }
//   GET /health -> { ok: true }
//
// Every source below is independently wrapped in try/catch with a hard 2s
// timeout. A source that fails reports an explicit unavailable state (null +
// error string) -- it never fabricates a zero or a stale value presented as
// fresh. This is a monitoring device: a missing number is honest, a wrong
// one is not.
//
// DOES NOT MODIFY, start, or talk to the existing ~/claude-thing/daemon
// (127.0.0.1:8790) -- this is a separate, new, read-only service.

const http = require('node:http')
const fs = require('node:fs/promises')
const { execFile } = require('node:child_process')

const PORT = 8791
const HOST = '127.0.0.1'
const SOURCE_TIMEOUT_MS = 2000

const ROUTER_URL = 'http://127.0.0.1:8081/v1/models'
// ⚠ NOT localhost. The always-on generalist ("coder") runs on the secondary-host
// box, not this one — the ":8084" shorthand used everywhere omits the host and
// probing 127.0.0.1 reports a healthy service as OFFLINE. `/health` is the
// endpoint the session-start fleet probe uses; match it.
const CODER_URL = 'http://192.0.2.11:8084/health'
const QUEUE_ROOT = '/home/youruser/project/piplay/pi-harness/.pi/queue'
const QUEUE_DIRS = ['pending', 'in-progress', 'done', 'review', 'escalated', 'failed']
const OBLIGATIONS_SCRIPT = '/home/youruser/project/_standards/obligations/obligations.py'
const OBLIGATIONS_CACHE_MS = 30_000

/** Fetch with a hard timeout via AbortController -- never let a slow peer
 *  hold up the whole /state response. */
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 1. Router model state -- which model (if any) is loaded, plus total count.
 *  "router up, nothing loaded" is a normal IDLE state, never an error. */
async function readFleetRouter() {
  try {
    const res = await fetchWithTimeout(ROUTER_URL, SOURCE_TIMEOUT_MS)
    if (!res.ok) return { available: false, loaded: null, count: null, error: `http ${res.status}` }
    const body = await res.json()
    const models = Array.isArray(body?.data) ? body.data : []
    const loadedEntry = models.find((m) => m?.status?.value === 'loaded')
    return { available: true, loaded: loadedEntry ? loadedEntry.id : null, count: models.length }
  } catch (err) {
    return { available: false, loaded: null, count: null, error: String(err?.message ?? err) }
  }
}

/** 2. :8084 reachability only -- a plain boolean. Do NOT parse a body; it
 *  returned empty on the always-on generalist when probed. */
async function readFleetCoder() {
  try {
    await fetchWithTimeout(CODER_URL, SOURCE_TIMEOUT_MS)
    return { reachable: true }
  } catch (err) {
    return { reachable: false, error: String(err?.message ?? err) }
  }
}

/** 3. Queue depth -- count non-dotfile entries in each of the six state dirs.
 *  Each directory is read independently so one missing dir doesn't blank
 *  the rest. */
async function readQueueCounts() {
  const out = {}
  for (const dir of QUEUE_DIRS) {
    const key = dir === 'in-progress' ? 'inProgress' : dir
    try {
      const entries = await fs.readdir(`${QUEUE_ROOT}/${dir}`)
      out[key] = entries.filter((n) => !n.startsWith('.')).length
    } catch (err) {
      out[key] = null
      out[`${key}Error`] = String(err?.message ?? err)
    }
  }
  return out
}

/** execFile helper -- argv array, never a shell string, hard timeout. */
function execFileTimeout(cmd, args, ms) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: ms }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

/** 4. Obligations aggregate line -- cached 30s so /state polling (every 5s
 *  from the device) doesn't shell out on every hit. */
let obligationsCache = { line: null, error: null, cachedAt: 0 }
async function readObligations() {
  const age = Date.now() - obligationsCache.cachedAt
  if (obligationsCache.cachedAt && age < OBLIGATIONS_CACHE_MS) return obligationsCache
  try {
    const stdout = await execFileTimeout('python3', [OBLIGATIONS_SCRIPT, 'status'], SOURCE_TIMEOUT_MS)
    obligationsCache = { line: stdout.trim(), error: null, cachedAt: Date.now() }
  } catch (err) {
    obligationsCache = { line: null, error: String(err?.message ?? err), cachedAt: Date.now() }
  }
  return obligationsCache
}

/** Parses one `df -k` data row into {freeKb, totalKb, usedPct}. */
function parseDfLine(line) {
  // Columns: Filesystem 1K-blocks Used Available Use% Mounted-on. Filesystem
  // and Mounted-on can contain spaces (e.g. "C:\"), so parse from the right.
  const parts = line.trim().split(/\s+/)
  if (parts.length < 5) return null
  const usePctStr = parts[parts.length - 2]
  const availStr = parts[parts.length - 3]
  const usedStr = parts[parts.length - 4]
  const totalStr = parts[parts.length - 5]
  void usedStr
  const totalKb = Number(totalStr)
  const freeKb = Number(availStr)
  const usedPct = Number(usePctStr.replace('%', ''))
  if (!Number.isFinite(totalKb) || !Number.isFinite(freeKb) || !Number.isFinite(usedPct)) return null
  return { freeKb, totalKb, usedPct }
}

/** 5. Disk free/total for / and /mnt/c (the Windows drive that fills up). */
async function readDisk() {
  try {
    const stdout = await execFileTimeout('df', ['-k', '/', '/mnt/c'], SOURCE_TIMEOUT_MS)
    const lines = stdout.trim().split('\n').slice(1) // drop header
    return { root: lines[0] ? parseDfLine(lines[0]) : null, mntC: lines[1] ? parseDfLine(lines[1]) : null }
  } catch (err) {
    return { root: null, mntC: null, error: String(err?.message ?? err) }
  }
}

async function buildState() {
  const [router, coder, queueCounts, obligations, disk] = await Promise.all([
    readFleetRouter(),
    readFleetCoder(),
    readQueueCounts(),
    readObligations(),
    readDisk(),
  ])
  return {
    fleet: { router, coder },
    queue: { ...queueCounts, obligations },
    system: { disk },
    ts: Date.now(),
  }
}

/**
 * ⚠ CORS is REQUIRED, not optional. The device's kiosk page is loaded from
 * `file://`, so every fetch it makes is cross-origin from an opaque origin and
 * Chromium blocks the response without this header:
 *
 *   Failed to load http://127.0.0.1:8791/state: No 'Access-Control-Allow-Origin'
 *   header is present. Origin 'file://' is therefore not allowed access.
 *
 * The existing daemon does not need this only because WebSockets are not
 * subject to CORS — a plain fetch is. Verified on device: without this header
 * both slots render "DEVICEINFO SERVICE UNREACHABLE" while a device-side
 * `wget` to the same URL succeeds, which is the confusing part.
 *
 * `*` is fine here: this service is read-only, exposes no secrets, and binds
 * loopback only (see the threat model in the internal plans).
 */
const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_HEADERS)
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }
  if (req.url === '/health') {
    res.writeHead(200, JSON_HEADERS)
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (req.url === '/state') {
    try {
      const state = await buildState()
      res.writeHead(200, JSON_HEADERS)
      res.end(JSON.stringify(state))
    } catch (err) {
      res.writeHead(500, JSON_HEADERS)
      res.end(JSON.stringify({ error: String(err?.message ?? err) }))
    }
    return
  }
  res.writeHead(404, JSON_HEADERS)
  res.end(JSON.stringify({ error: 'not found' }))
})

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`deviceinfo listening on http://${HOST}:${PORT}`)
  })
}

module.exports = { server, buildState }
