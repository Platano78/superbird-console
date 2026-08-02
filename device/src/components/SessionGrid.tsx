import type { SessionSummary } from '../protocol'

const STATE_COLOR: Record<SessionSummary['state'], string> = {
  attention: 'border-amber-400 bg-amber-950',
  busy: 'border-sky-600 bg-sky-950',
  celebrate: 'border-emerald-500 bg-emerald-950',
  idle: 'border-neutral-800 bg-neutral-900',
}

/** Context fill only earns colour once it is worth acting on. */
function ctxTone(v: number) {
  if (v >= 0.9) return 'bg-red-400'
  if (v >= 0.75) return 'bg-amber-400'
  return 'bg-neutral-300'
}

/**
 * Resting view: every live session at a glance. Scrolls sideways because the
 * daemon's snapshot is unbounded — it sends all sessions, not a capped page.
 *
 * Read from across a desk: the state word and the name are the only things
 * sized to be legible at distance; numbers are for when you lean in.
 */
/** Relative activity is the thing you actually want mid-tile: is it moving?
 *  Exported — SessionDetail reuses it rather than duplicating the logic. */
export function ago(ts: number, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

type Props = {
  sessions: SessionSummary[]
  nowMs: number
  /** Tapping a tile opens its detail view. */
  onSelect: (id: string) => void
}

export function SessionGrid({ sessions, nowMs, onSelect }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-2xl text-neutral-600">
        No active sessions
      </div>
    )
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {sessions.map((s) => {
        const pct = s.context === null ? null : Math.round(s.context * 100)
        // ATTENTION means two different things upstream (approve a tool call,
        // or type a reply the device can't send) — one word hid that from the
        // owner. Split it; the amber treatment stays the same either way.
        const stateLabel = s.state === 'attention' ? (s.pendingPermission ? 'APPROVE' : 'WAITING') : s.state
        return (
          <div
            key={s.id}
            role="button"
            onClick={() => onSelect(s.id)}
            className={`relative flex h-full w-56 shrink-0 cursor-pointer flex-col justify-between overflow-hidden rounded-xl border-2 p-4 transition-colors duration-500 active:brightness-90 ${STATE_COLOR[s.state]}`}
          >
            {/* BUSY: one travelling highlight = work in progress. */}
            {s.state === 'busy' && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 w-1/4 animate-sweep bg-sky-300/70" />
            )}

            <div>
              <div className="truncate text-xl font-semibold text-white">{s.name}</div>
              <div
                className={`mt-1 text-sm uppercase tracking-wide ${
                  s.state === 'attention' ? 'animate-breathe font-semibold text-amber-300' : 'text-neutral-500'
                }`}
              >
                {stateLabel}
              </div>
            </div>

            {/* Fills what was dead space, and answers the question you actually
                have looking across the room: is this one still moving? */}
            <div className="text-3xl font-light tabular-nums text-white/80">
              {ago(s.lastActivityTs, nowMs)}
            </div>

            <div className="text-sm">
              {/* context is 0..1 or null — null means the daemon has no reading yet */}
              {pct !== null && (
                <div className="mb-2">
                  <div className="h-2 w-full overflow-hidden rounded bg-neutral-800">
                    <div
                      className={`h-2 rounded transition-[width] duration-700 ease-out ${ctxTone(s.context!)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1 tabular-nums text-neutral-400">{pct}% ctx</div>
                </div>
              )}
              <div className="tabular-nums text-neutral-500">
                {(s.tokens.in / 1000).toFixed(1)}k in · {(s.tokens.out / 1000).toFixed(1)}k out
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
