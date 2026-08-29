// Token-checking LAN gateway in front of the claude-thing daemon + deviceinfo
// service, so a LAN client (the wall panel) can reach them without
// USB/adb reverse. Plain Node, zero npm dependencies (node:http / node:net /
// node:fs / node:crypto only) -- same precedent as services/deviceinfo.
//
// The security model up to now was PHYSICAL: both upstreams bind
// 127.0.0.1-only and were reached over `adb reverse` from a cabled device.
// A LAN client changes that, so every request here -- HTTP and WebSocket
// upgrade alike -- must carry `Authorization: Bearer <token>` matching the
// contents of PG_TOKEN_FILE. Wrong/missing token -> 401, nothing forwarded.
// A missing/empty token file is a FATAL startup error: this gateway must
// never come up open.
//
// DOES NOT MODIFY, start, or fork the existing claude-thing daemon
// (127.0.0.1:8790) or the deviceinfo service (127.0.0.1:8791) -- this is a
// separate, new proxy in front of both.

const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const HOST = process.env.PG_HOST || '0.0.0.0'
const PORT = Number(process.env.PG_PORT || 8793)
const DAEMON_PORT = 8790
const DEVICEINFO_PORT = 8791

// Default resolves next to this checkout's minted token (services/panel-gateway-token.txt,
// one directory up from this file) -- overridable via env like every other
// host-specific value in this repo (see deviceinfo's CAR_THING_ADB etc.).
const TOKEN_FILE = process.env.PG_TOKEN_FILE || path.join(__dirname, '..', 'panel-gateway-token.txt')

let TOKEN
try {
  TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
} catch (err) {
  console.error(`[panel-gateway] FATAL: cannot read token file ${TOKEN_FILE}: ${err.message}`)
  process.exit(1)
}
if (!TOKEN) {
  console.error(`[panel-gateway] FATAL: token file ${TOKEN_FILE} is empty -- refusing to start open`)
  process.exit(1)
}
const TOKEN_BUF = Buffer.from(TOKEN)

/** Constant-time compare against the loaded token. Length mismatch is
 *  rejected before touching timingSafeEqual (it throws on unequal-length
 *  buffers rather than returning false). */
function isAuthorized(headers) {
  const auth = headers['authorization']
  if (typeof auth !== 'string') return false
  const m = auth.match(/^Bearer (.+)$/)
  if (!m) return false
  const presented = Buffer.from(m[1])
  if (presented.length !== TOKEN_BUF.length) return false
  return crypto.timingSafeEqual(presented, TOKEN_BUF)
}

function unauthorized(res) {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'unauthorized' }))
}

/** Plain reverse proxy for one request -- forwards method/headers/body to
 *  127.0.0.1:targetPort+targetPath with Authorization stripped (the token
 *  is this gateway's business, not the upstream's), streams the response
 *  back verbatim. Upstream connection refused (daemon/deviceinfo down)
 *  reports 502 rather than hanging the client. */
function proxyHttp(req, res, targetPort, targetPath) {
  const headers = { ...req.headers }
  delete headers['authorization']
  headers['host'] = `127.0.0.1:${targetPort}`
  const upstreamReq = http.request(
    { host: '127.0.0.1', port: targetPort, method: req.method, path: targetPath, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers)
      upstreamRes.pipe(res)
    },
  )
  upstreamReq.on('error', (err) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `upstream unreachable: ${err.message}` }))
  })
  req.pipe(upstreamReq)
}

const server = http.createServer((req, res) => {
  if (!isAuthorized(req.headers)) {
    unauthorized(res)
    return
  }
  if (req.method === 'GET' && req.url === '/status') {
    proxyHttp(req, res, DAEMON_PORT, '/status')
    return
  }
  if (req.url === '/deviceinfo' || req.url.startsWith('/deviceinfo/')) {
    const rest = req.url.slice('/deviceinfo'.length)
    proxyHttp(req, res, DEVICEINFO_PORT, rest || '/')
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

// WebSocket forwarding is a TCP splice, not a re-implementation: validate
// the token on the upgrade request's own headers, open a plain TCP
// connection to the daemon, replay the upgrade request line + headers
// (Authorization stripped) plus any bytes the parser already buffered past
// the header block, then pipe both sockets until either side closes. Never
// parses a WS frame. If the daemon refuses the connection, the client gets
// a 502 and the socket is torn down before any piping starts.
server.on('upgrade', (req, socket, head) => {
  if (!isAuthorized(req.headers)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  if (req.url !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const upstream = net.connect(DAEMON_PORT, '127.0.0.1', () => {
    const headers = { ...req.headers }
    delete headers['authorization']
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const v of value) lines.push(`${key}: ${v}`)
      } else {
        lines.push(`${key}: ${value}`)
      }
    }
    lines.push('', '')
    upstream.write(lines.join('\r\n'))
    if (head && head.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  upstream.on('error', (err) => {
    console.error(`[panel-gateway] /ws upstream error: ${err.message}`)
    if (!socket.destroyed) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      socket.destroy()
    }
  })
  socket.on('error', () => upstream.destroy())
})

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`panel-gateway listening on http://${HOST}:${PORT} -> daemon:${DAEMON_PORT} deviceinfo:${DEVICEINFO_PORT}`)
  })
}

module.exports = { server }
