import { useEffect, useRef, useState } from 'react'
import { Daemon, type State } from './daemon'
import { AskCard } from './components/AskCard'
import { SessionGrid } from './components/SessionGrid'
import { SessionDetail } from './components/SessionDetail'
import { UsageRail } from './components/UsageRail'
import { PresetBar } from './components/PresetBar'
import { useHardwareKeys } from './useHardwareKeys'

/** A warning lamp only lights for data that actually exists in app state —
 *  no MCP-health/disk lamps yet, that data doesn't exist until slice 3. */
function Lamp({ lit, color, label }: { lit: boolean; color: string; label: string }) {
  return (
    <span className="flex items-center" style={{ marginLeft: 10 }}>
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: lit ? color : '#44403c' }}
      />
      <span className={`ml-1 text-[10px] uppercase tracking-wide ${lit ? 'text-stone-300' : 'text-stone-700'}`}>
        {label}
      </span>
    </span>
  )
}

const EMPTY: State = { connected: false, snapshot: null, asks: [], usage: null, offsetMs: 0, lastAskBySession: {} }

export default function App() {
  const [state, setState] = useState<State>(EMPTY)
  const [, tick] = useState(0)
  const daemon = useRef<Daemon | null>(null)
  // Session tile tapped open for detail — Escape (physical back button) closes it.
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  useEffect(() => {
    const d = (daemon.current = new Daemon())
    d.onState = setState
    d.connect()
    // One interval for the app lifetime, purely to advance countdowns.
    // Never key an effect on snapshot.serverNowMs — the daemon recomputes it
    // per snapshot, which caused React #185 (max update depth) on the device.
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const ask = state.asks[0]
  const nowMs = Date.now() + state.offsetMs

  // A pending ask always wins over the detail view — this device exists to
  // answer these, and a detail view left open must never blind it to one.
  // Keyed on the ask's id (a stable string), never the ask object or `state`
  // itself — the daemon rebuilds both every snapshot, which is the same
  // React #185 trap the polling interval above already dodges.
  useEffect(() => {
    if (ask) setOpenSessionId(null)
  }, [ask?.id])

  const sessions = state.snapshot?.sessions ?? []
  const selectedSession = openSessionId ? sessions.find((s) => s.id === openSessionId) : undefined
  // The queue's own live ask for the tapped session, if any — takes priority
  // over the cached one in SessionDetail's routing.
  const detailLiveAsk = selectedSession ? state.asks.find((a) => a.sessionId === selectedSession.id) : undefined
  // Whichever ask is actually on screen right now: the detail's, if a detail
  // is open, else the top-level auto-popup's.
  const activeAsk = selectedSession ? detailLiveAsk : ask

  const onPermission = (requestId: string, decision: 'allow' | 'deny') => {
    const target = activeAsk?.id === requestId ? activeAsk : undefined
    if (target) void daemon.current?.answer(target, decision)
  }
  const flash = useHardwareKeys({
    ask: activeAsk,
    onPermission,
    hasOpenDetail: !!selectedSession,
    onEscape: () => setOpenSessionId(null),
  })

  // Only lamps backed by real state: connection, and plan-limit pressure
  // (any limit at or past 90%) — no MCP-health/disk lamps until that data
  // exists (slice 3).
  const limitPressure = state.usage?.limits?.some((l) => l.used >= 0.9) ?? false

  return (
    <div className="flex h-screen w-screen flex-col bg-stone-950 text-stone-50">
      <header className="flex h-[40px] shrink-0 items-center justify-between border-b border-stone-800 bg-stone-950 px-3">
        <span className="flex items-baseline">
          <span className="text-sm font-semibold tracking-wide text-stone-200">CLAUDE CODE</span>
          <span className="ml-2 text-xs tabular-nums text-stone-500">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
        </span>
        <span className="flex items-center">
          <Lamp lit={limitPressure} color="#f87171" label="limit" />
          <Lamp lit={state.connected} color="#34d399" label={state.connected ? 'online' : 'offline'} />
          {state.asks.length > 1 && (
            <span className="ml-3 text-xs text-amber-300">+{state.asks.length - 1} waiting</span>
          )}
        </span>
      </header>

      <main className="min-h-0 flex-1">
        {selectedSession ? (
          <SessionDetail
            session={selectedSession}
            liveAsk={detailLiveAsk}
            cachedAsk={state.lastAskBySession[selectedSession.id]}
            nowMs={nowMs}
            onPermission={onPermission}
            flash={flash}
            onClose={() => setOpenSessionId(null)}
          />
        ) : ask ? (
          <AskCard ask={ask} nowMs={nowMs} onPermission={onPermission} flash={flash} />
        ) : (
          <SessionGrid sessions={sessions} nowMs={nowMs} onSelect={setOpenSessionId} />
        )}
      </main>

      {/* Hidden while an ask or the detail view is up — answering/reading is
          the whole screen's job then. */}
      {!ask && !selectedSession && (
        <>
          <UsageRail usage={state.usage} />
          <PresetBar />
        </>
      )}
    </div>
  )
}
