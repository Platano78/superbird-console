import { useEffect, useRef, useState } from 'react'
import { Daemon, type State } from './daemon'
import { AskCard } from './components/AskCard'
import { SessionGrid } from './components/SessionGrid'
import { SessionDetail } from './components/SessionDetail'
import { UsageRail } from './components/UsageRail'
import { TopBar } from './components/TopBar'
import { FleetSlot } from './components/FleetSlot'
import { MbSlot } from './components/MbSlot'
import { ControlSlot } from './components/ControlSlot'
import { useHardwareKeys } from './useHardwareKeys'
import { useDeviceInfo } from './deviceInfo'

const EMPTY: State = { connected: false, snapshot: null, asks: [], usage: null, offsetMs: 0, lastAskBySession: {} }

export default function App() {
  const [state, setState] = useState<State>(EMPTY)
  const [, tick] = useState(0)
  const daemon = useRef<Daemon | null>(null)
  // Session tile tapped open for detail — Escape (physical back button) closes it.
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  // Which of the four preset slots is showing. All four are built.
  const [activeSlot, setActiveSlot] = useState(1)
  // Fleet/queue/disk state for slots 2-3 — its own poll, entirely separate
  // from the daemon connection above.
  const deviceInfo = useDeviceInfo()

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
  // Single source of truth for slot switching — passed to both the hardware
  // keys and the on-screen TopBar, never duplicated between them.
  const onSlotChange = (slot: number) => {
    setActiveSlot(slot)
    setOpenSessionId(null) // switching slots closes any open session detail
  }
  const flash = useHardwareKeys({
    ask: activeAsk,
    onPermission,
    hasOpenDetail: !!selectedSession,
    onEscape: () => setOpenSessionId(null),
    activeSlot,
    onSlotChange,
  })

  // Only lamps backed by real state: connection, and plan-limit pressure
  // (any limit at or past 90%) — no MCP-health/disk lamps until that data
  // exists (slice 3).
  const limitPressure = state.usage?.limits?.some((l) => l.used >= 0.9) ?? false

  return (
    <div className="flex h-screen w-screen flex-col bg-stone-950 text-stone-50">
      {/* Top edge, touching it, so each label sits under its physical preset
          button — always rendered (never hidden for an ask/detail), same as
          the header it replaces; only the limits rail below still hides. */}
      <TopBar
        activeSlot={activeSlot}
        onSelect={onSlotChange}
        limitPressure={limitPressure}
        connected={state.connected}
        waitingCount={state.asks.length - 1}
      />

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
          // A pending ask steals the screen regardless of which slot is
          // active — see AGENTS.md: "ask > app switching, always."
          <AskCard ask={ask} nowMs={nowMs} onPermission={onPermission} flash={flash} />
        ) : activeSlot === 1 ? (
          <SessionGrid sessions={sessions} nowMs={nowMs} onSelect={setOpenSessionId} />
        ) : activeSlot === 2 ? (
          <FleetSlot info={deviceInfo.data} reachable={deviceInfo.reachable} />
        ) : activeSlot === 3 ? (
          <MbSlot info={deviceInfo.data} reachable={deviceInfo.reachable} />
        ) : (
          <ControlSlot info={deviceInfo.data} reachable={deviceInfo.reachable} />
        )}
      </main>

      {/* Hidden while an ask or the detail view is up — answering/reading is
          the whole screen's job then. */}
      {!ask && !selectedSession && <UsageRail usage={state.usage} />}
    </div>
  )
}
