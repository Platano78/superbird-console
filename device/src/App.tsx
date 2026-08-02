import { useEffect, useRef, useState } from 'react'
import { Daemon, type State } from './daemon'
import { AskCard } from './components/AskCard'
import { SessionGrid } from './components/SessionGrid'
import { UsageRail } from './components/UsageRail'
import { useHardwareKeys } from './useHardwareKeys'

const EMPTY: State = { connected: false, snapshot: null, asks: [], usage: null, offsetMs: 0 }

export default function App() {
  const [state, setState] = useState<State>(EMPTY)
  const [, tick] = useState(0)
  const daemon = useRef<Daemon | null>(null)

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

  const onPermission = (_id: string, decision: 'allow' | 'deny') => {
    if (ask) void daemon.current?.answer(ask, decision)
  }
  const onQuestion = (_id: string, optionIndex: number) => {
    if (ask) void daemon.current?.answer(ask, 'allow', optionIndex)
  }
  const flash = useHardwareKeys({ ask, onPermission, onQuestion })

  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 py-2 text-sm text-neutral-400">
        <span>Claude Code</span>
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${state.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          {state.connected ? 'connected' : 'offline'}
          {state.asks.length > 1 && (
            <span className="ml-2 text-amber-300">+{state.asks.length - 1} waiting</span>
          )}
        </span>
      </header>

      <main className="min-h-0 flex-1">
        {ask ? (
          <AskCard
            ask={ask}
            nowMs={nowMs}
            onPermission={onPermission}
            onQuestion={onQuestion}
            flash={flash}
          />
        ) : (
          <SessionGrid sessions={state.snapshot?.sessions ?? []} nowMs={nowMs} />
        )}
      </main>

      {/* Hidden while an ask is up — answering is the whole screen's job then. */}
      {!ask && <UsageRail usage={state.usage} />}
    </div>
  )
}
