/**
 * Direct browser client for the claude-thing daemon — no DeskThing in the path.
 *
 * Runs ON the Car Thing in Chromium kiosk, reaching the host daemon through
 * `adb reverse tcp:8790 tcp:8790`. That transport was proven end-to-end on
 * 2026-08-01 (WebSocket 101 upgrade + live claude.* frames on the device).
 *
 * Two protocol facts that bite, both verified against a live daemon:
 *   - every request MUST carry type:"request" or hub.js:42 drops it silently
 *   - bridge.hello must be the first frame
 */

import type { Snapshot, Ask, Usage } from './protocol'

const URL = `ws://${location.hostname || '127.0.0.1'}:8790/ws`

export type State = {
  connected: boolean
  snapshot: Snapshot | null
  asks: Ask[]
  usage: Usage | null
  /** daemon clock minus device clock — the device has no RTC and no NTP */
  offsetMs: number
}

export class Daemon {
  private ws: WebSocket | null = null
  private nextId = 0
  private pending = new Map<number, (v: unknown, err?: string) => void>()

  state: State = { connected: false, snapshot: null, asks: [], usage: null, offsetMs: 0 }
  onState: ((s: State) => void) | null = null

  private emit = () => this.onState?.({ ...this.state })

  connect = () => {
    const ws = (this.ws = new WebSocket(URL))

    ws.onopen = async () => {
      this.state.connected = true
      try {
        await this.request('bridge.hello', { role: 'car-thing' })
        await this.refresh()
      } catch {
        /* the next event triggers another refresh */
      }
      this.emit()
    }

    ws.onmessage = (e) => this.onFrame(String(e.data))

    ws.onclose = () => {
      this.state.connected = false
      this.pending.forEach((fn) => fn(null, 'disconnected'))
      this.pending.clear()
      this.emit()
      setTimeout(this.connect, 3000)
    }
  }

  private onFrame(raw: string) {
    let m: { type?: string; id?: number; result?: unknown; error?: string; topic?: string; data?: unknown }
    try { m = JSON.parse(raw) } catch { return }

    if (m.type === 'event') {
      if (m.topic === 'claude.sessions.update') this.setSnapshot(m.data as Snapshot)
      // Only queue topics need a re-fetch; session ticks fire constantly and
      // re-fetching on each one storms the daemon.
      if (m.topic === 'claude.usage.update') { this.state.usage = m.data as Usage; this.emit(); return }
      if (/permission|question/.test(m.topic || '')) void this.refreshQueue()
      else this.emit()
      return
    }

    const fn = typeof m.id === 'number' && this.pending.get(m.id)
    if (!fn) return
    this.pending.delete(m.id as number)
    fn(m.result, m.type === 'error' ? m.error || 'daemon error' : undefined)
  }

  private setSnapshot(s: Snapshot) {
    this.state.snapshot = s
    if (typeof s?.serverNowMs === 'number') this.state.offsetMs = s.serverNowMs - Date.now()
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((ok, fail) => {
      if (this.ws?.readyState !== 1) return fail(new Error('not connected'))
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(method + ' timed out')) }, 10_000)
      this.pending.set(id, (v, err) => { clearTimeout(timer); err ? fail(new Error(err)) : ok(v) })
      this.ws.send(JSON.stringify({ type: 'request', id, method, params }))
    })
  }

  async refresh() {
    this.setSnapshot((await this.request('claude.sessions.list')) as Snapshot)
    // The daemon pushes claude.usage.update once a minute; fetch once up front
    // so the rail is populated before the first push lands.
    try { this.state.usage = (await this.request('claude.usage.get')) as Usage } catch { /* rail hides */ }
    await this.refreshQueue()
  }

  async refreshQueue() {
    try {
      this.state.asks = ((await this.request('claude.queue.list')) as { asks: Ask[] }).asks || []
    } catch { /* keep the last known queue rather than blanking the screen */ }
    this.emit()
  }

  /** permissions and questions are DIFFERENT daemon methods — see protocol.ts */
  answer = async (a: Ask, decision: 'allow' | 'deny', optionIndex = 0) => {
    if (a.kind === 'question') await this.request('claude.question.answer', { id: a.id, optionIndex })
    else await this.request('claude.permission.answer', { requestId: a.id, decision })
    await this.refreshQueue()
  }
}
