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

// -- slice 5: CONTROL (model load/kill + device-info strip) --
//
// Windows adb.exe, NOT WSL's own adb -- the device is on the Windows USB bus.
// Must be addressed by serial: a bare `adb shell` aborts with "more than one
// device/emulator" the instant a second device (e.g. a phone) joins the adb
// server -- see scripts/keep-adb-reverse.sh for the incident this already
// caused once.
const ADB = '/mnt/c/Users/YOURUSER/AppData/Local/Programs/deskthing/resources/win/adb.exe'
const CAR_THING_SERIAL = process.env.CAR_THING_SERIAL || 'DEVICESERIAL'
const ROUTER_CONTROL = '/home/youruser/project/llama-cpp-native/router-control.sh'
const START_ROUTER = '/home/youruser/project/llama-cpp-native/start-router.sh'
const DEVICE_CACHE_MS = 20_000
// Not the 2s SOURCE_TIMEOUT_MS -- a model load is genuinely slow. This is a
// safety net against a hung process, not a bound on the HTTP response (the
// response never waits on this; see the /action handler).
const ACTION_HARD_TIMEOUT_MS = 5 * 60_000
const ACTION_OUTPUT_CAP_BYTES = 8192

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
 *  "router up, nothing loaded" is a normal IDLE state, never an error.
 *  `loading` is the model whose live `status.value === 'loading'` (captured
 *  on hardware mid-load: `{"value":"loading","args":[...],"preset":"..."}`)
 *  -- the CONTROL tile's in-progress cue is driven off this, never a
 *  client-side timer guessing when a load finishes. */
async function readFleetRouter() {
  try {
    const res = await fetchWithTimeout(ROUTER_URL, SOURCE_TIMEOUT_MS)
    if (!res.ok) return { available: false, loaded: null, loading: null, count: null, ids: [], error: `http ${res.status}` }
    const body = await res.json()
    const models = Array.isArray(body?.data) ? body.data : []
    const loadedEntry = models.find((m) => m?.status?.value === 'loaded')
    const loadingEntry = models.find((m) => m?.status?.value === 'loading')
    const ids = models.map((m) => m?.id).filter(Boolean)
    return {
      available: true,
      loaded: loadedEntry ? loadedEntry.id : null,
      loading: loadingEntry ? loadingEntry.id : null,
      count: models.length,
      ids,
    }
  } catch (err) {
    return { available: false, loaded: null, loading: null, count: null, ids: [], error: String(err?.message ?? err) }
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

/** 6. Rotating device-info strip -- one batched `adb shell` for all five
 *  readings (never five separate invocations), cached 20s so the device's
 *  5s /state poll doesn't hammer adb. */
const DEVICE_SPLIT = '__CARTHING_SPLIT__'
let deviceCache = { data: null, cachedAt: 0 }

function parseFreeM(block) {
  const line = block?.split('\n').find((l) => l.trim().startsWith('Mem:'))
  if (!line) return null
  const [, totalMb, usedMb, freeMb] = line.trim().split(/\s+/).map(Number)
  return Number.isFinite(totalMb) && Number.isFinite(usedMb) && Number.isFinite(freeMb) ? { totalMb, usedMb, freeMb } : null
}

function parseDfH(block) {
  const line = block?.trim().split('\n')[1]
  if (!line) return null
  const parts = line.trim().split(/\s+/)
  return parts.length >= 5 ? { size: parts[1], used: parts[2], avail: parts[3], usePct: parts[4] } : null
}

function parseUptime(block) {
  const raw = block?.trim() || null
  const m = raw?.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  return { raw, load1: m ? Number(m[1]) : null, load5: m ? Number(m[2]) : null, load15: m ? Number(m[3]) : null }
}

async function readDevice() {
  const age = Date.now() - deviceCache.cachedAt
  if (deviceCache.cachedAt && age < DEVICE_CACHE_MS) return deviceCache.data
  const remoteCmd = [
    'cat /sys/class/thermal/thermal_zone0/temp',
    'uptime',
    'free -m',
    'df -h /',
    'cat /sys/class/backlight/aml-bl/brightness',
  ].join(`; echo ${DEVICE_SPLIT}; `)
  let data
  try {
    const stdout = await execFileTimeout(ADB, ['-s', CAR_THING_SERIAL, 'shell', remoteCmd], SOURCE_TIMEOUT_MS)
    const [tempRaw, uptimeRaw, freeRaw, dfRaw, blRaw] = stdout.split(DEVICE_SPLIT).map((s) => s.trim())
    const tempMilli = Number(tempRaw)
    data = {
      tempC: Number.isFinite(tempMilli) ? tempMilli / 1000 : null,
      uptime: parseUptime(uptimeRaw),
      memory: parseFreeM(freeRaw),
      disk: parseDfH(dfRaw),
      backlight: Number.isFinite(Number(blRaw)) ? Number(blRaw) : null,
    }
  } catch (err) {
    data = { error: String(err?.message ?? err) }
  }
  deviceCache = { data, cachedAt: Date.now() }
  return data
}

async function buildState() {
  const [router, coder, queueCounts, obligations, disk, device] = await Promise.all([
    readFleetRouter(),
    readFleetCoder(),
    readQueueCounts(),
    readObligations(),
    readDisk(),
    readDevice(),
  ])
  return {
    fleet: { router, coder },
    queue: { ...queueCounts, obligations },
    system: { disk },
    device,
    ts: Date.now(),
  }
}

/** Enumerated allowlist: `kill` and `load:<live-model-id>` are the only two
 *  shapes. The id is never interpolated into a shell string -- it becomes
 *  one argv element to execFile, and only after being checked against the
 *  router's own live roster (readFleetRouter -- same source /state uses,
 *  never a hardcoded list). */
async function resolveAction(id) {
  // Unlike `kill`/`load:`, these must NOT be gated behind readFleetRouter()
  // .available -- `router:start` exists precisely for when the router is
  // NOT reachable, so requiring it to be reachable first would make the
  // one recovery action unreachable exactly when it's needed.
  if (id === 'router:start') return { argv: [START_ROUTER, 'start'] }
  if (id === 'router:stop') return { argv: [START_ROUTER, 'stop'] }
  // ⚠ `unload` REQUIRES a preset argument. router-control.sh:341 errors with
  // "Usage: router-control.sh unload <preset>" and returns 1 when called bare,
  // so a bare `unload` would have made KILL a guaranteed no-op failure. Resolve
  // it against whatever is actually loaded right now, and refuse cleanly when
  // nothing is — "nothing to kill" is a normal state, not an error condition.
  if (id === 'kill') {
    const router = await readFleetRouter()
    if (!router.available) return { error: `router unreachable: ${router.error ?? 'unknown'}` }
    if (!router.loaded) return { error: 'no model loaded' }
    return { argv: [ROUTER_CONTROL, 'unload', router.loaded] }
  }
  if (typeof id === 'string' && id.startsWith('load:')) {
    const modelId = id.slice('load:'.length)
    const router = await readFleetRouter()
    if (!router.available) return { error: `router unreachable: ${router.error ?? 'unknown'}` }
    if (!router.ids.includes(modelId)) return { error: `unknown model id: ${modelId}` }
    return { argv: [ROUTER_CONTROL, 'switch', modelId] }
  }
  return { error: `unknown action id: ${id}` }
}

function logAction(id, argv, exitInfo) {
  console.log(`[action] ${new Date().toISOString()} id=${id} argv=${JSON.stringify(argv)} exit=${exitInfo}`)
}

/** Fire-and-forget spawn -- the HTTP response never waits on this. Timeout
 *  is a hang safety net, not a response bound; maxBuffer is the output cap. */
function spawnAction(argv) {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: ACTION_HARD_TIMEOUT_MS, maxBuffer: ACTION_OUTPUT_CAP_BYTES }, (err) => {
      resolve(err ? `error(${err.code ?? err.signal ?? err.message})` : '0')
    })
  })
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
 * `*` is fine here: this service is read-only (except the enumerated /action
 * allowlist below), exposes no secrets, and binds loopback only (see the
 * threat model in the internal plans).
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  // POST + a JSON content-type triggers a CORS preflight (OPTIONS) -- these
  // two headers are what make that preflight succeed. Missing either one
  // fails /action's POST the exact same silent way GET /state failed before
  // access-control-allow-origin was added.
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
}
const JSON_HEADERS = { 'content-type': 'application/json', ...CORS_HEADERS }
const MAX_ACTION_BODY_BYTES = 4096

function readActionId(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_ACTION_BODY_BYTES) req.destroy(new Error('body too large'))
    })
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}').id)
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  // Preflight for the POST below -- browsers send this before the real
  // request whenever it carries a JSON content-type.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, JSON_HEADERS)
    res.end(JSON.stringify({ ok: true }))
    return
  }
  if (req.method === 'GET' && req.url === '/state') {
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
  if (req.method === 'POST' && req.url === '/action') {
    let id
    try {
      id = await readActionId(req)
    } catch (err) {
      res.writeHead(400, JSON_HEADERS)
      res.end(JSON.stringify({ error: String(err?.message ?? err) }))
      return
    }
    const resolved = await resolveAction(id)
    if (resolved.error) {
      logAction(id, null, `rejected(${resolved.error})`)
      res.writeHead(400, JSON_HEADERS)
      res.end(JSON.stringify({ error: resolved.error }))
      return
    }
    const { argv } = resolved
    if (process.env.CARTHING_ACTION_DRYRUN === '1') {
      logAction(id, argv, 'DRYRUN (not spawned)')
      res.writeHead(202, JSON_HEADERS)
      res.end(JSON.stringify({ id, argv, dryRun: true }))
      return
    }
    // 202 fires immediately -- the device observes the actual result later
    // through /state's fleet.router.loaded, not through this response.
    res.writeHead(202, JSON_HEADERS)
    res.end(JSON.stringify({ id, argv }))
    spawnAction(argv).then((exitInfo) => logAction(id, argv, exitInfo))
    return
  }
  if (req.method === 'GET' || req.method === 'POST') {
    res.writeHead(404, JSON_HEADERS)
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  res.writeHead(405, JSON_HEADERS)
  res.end(JSON.stringify({ error: 'method not allowed' }))
})

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`deviceinfo listening on http://${HOST}:${PORT}`)
  })
}

module.exports = { server, buildState }
