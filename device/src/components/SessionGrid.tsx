import type { SessionSummary } from '../protocol'
import { GaugeArc, type GaugeTone } from './GaugeArc'

const STATE_ACCENT: Record<SessionSummary['state'], string> = {
  attention: '#fbbf24',
  busy: '#0369a1',
  celebrate: '#10b981',
  idle: '#44403c',
}

/** Same 0.75/0.9 thresholds as UsageRail, expressed as a gauge tone. */
function ctxTone(v: number | null): GaugeTone {
  if (v === null) return 'neutral'
  if (v >= 0.9) return 'red'
  if (v >= 0.75) return 'amber'
  return 'neutral'
}

/** Exported — SessionDetail reuses it rather than duplicating the logic. */
export function ago(ts: number, nowMs: number) {
  const s = Math.max(0, Math.round((nowMs - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

const GAUGE_SIZE: Record<number, number> = { 1: 200, 2: 168, 3: 142, 4: 120 }
const NAME_SIZE: Record<number, number> = { 1: 24, 2: 21, 3: 18, 4: 15 }

type Props = { sessions: SessionSummary[]; nowMs: number; onSelect: (id: string) => void }

export function SessionGrid({ sessions, nowMs, onSelect }: Props) {
  if (sessions.length === 0) {
    return <div className="flex h-full items-center justify-center text-2xl text-stone-600">No active sessions</div>
  }
  const count = sessions.length
  const composed = count <= 4
  const gaugeSize = composed ? GAUGE_SIZE[count] : 100
  const nameSize = composed ? NAME_SIZE[count] : 14
  const gridStyle = composed
    ? { display: 'grid' as const, gridTemplateColumns: `repeat(${count}, 1fr)` }
    : { display: 'grid' as const, gridAutoFlow: 'column' as const, gridAutoColumns: '150px', overflowX: 'auto' as const }

  return (
    <div className="h-full" style={gridStyle}>
      {sessions.map((s) => (
        <SessionTile key={s.id} s={s} nowMs={nowMs} gaugeSize={gaugeSize} nameSize={nameSize} onSelect={onSelect} />
      ))}
    </div>
  )
}

function SessionTile({
  s,
  nowMs,
  gaugeSize,
  nameSize,
  onSelect,
}: {
  s: SessionSummary
  nowMs: number
  gaugeSize: number
  nameSize: number
  onSelect: (id: string) => void
}) {
  const pct = s.context === null ? null : Math.round(s.context * 100)
  const stateLabel = s.state === 'attention' ? (s.pendingPermission ? 'APPROVE' : 'WAITING') : s.state
  return (
    // A shared cluster field, not a card: sessions are separated by a
    // hairline rule only — the way a speedo and tach share one binnacle.
    <div
      role="button"
      onClick={() => onSelect(s.id)}
      // overflow-hidden CLIPS THE BUSY SWEEP and is load-bearing. The sweep is
      // absolute + w-1/4 + translateX(400%), so it travels past this column's
      // right edge; the old card layout clipped it and that clip was lost when
      // the cards were removed. Unclipped it makes document.body.scrollWidth
      // exceed 800 mid-animation (measured 891), letting a touch panel drag the
      // whole kiosk sideways — and only while a session is BUSY, which is why
      // it reads as intermittent.
      className="relative flex h-full min-w-0 flex-col items-center overflow-hidden border-l border-stone-800 px-1 pt-2 first:border-l-0 active:brightness-90"
    >
      {s.state === 'busy' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 w-1/4 animate-sweep bg-sky-300/70" />
      )}
      <div style={{ display: 'grid' }} className="place-items-center">
        <div style={{ gridArea: '1 / 1' }}>
          <GaugeArc value={s.context} tone={ctxTone(s.context)} size={gaugeSize} />
        </div>
        <div style={{ gridArea: '1 / 1' }} className="text-center leading-none">
          <div className="font-bold tabular-nums text-stone-50" style={{ fontSize: Math.round(gaugeSize * 0.2) }}>
            {pct !== null ? `${pct}%` : '--'}
          </div>
          <div className="mt-0.5 text-[9px] uppercase tracking-widest text-stone-500">ctx</div>
        </div>
      </div>

      {/* gauge + name are one composed unit — tight, no dead gap between them */}
      <div className="-mt-1 w-full min-w-0 text-center">
        <div className="truncate font-semibold text-stone-50" style={{ fontSize: nameSize, lineHeight: 1.1 }}>
          {s.name}
        </div>
        <div style={{ background: STATE_ACCENT[s.state] }} className="mx-auto mt-0.5 h-[2px] w-8" />
      </div>

      <div
        className={`mt-1 truncate text-[11px] uppercase tracking-wide ${
          s.state === 'attention' ? 'animate-breathe font-semibold text-amber-300' : 'text-stone-500'
        }`}
      >
        {stateLabel}
      </div>

      {/* reclaimed vertical space: token counters, dropped in the first
          pass — real data belongs here, not empty air. */}
      <div className="mt-1 text-[11px] tabular-nums text-stone-400">
        {(s.tokens.in / 1000).toFixed(1)}k in · {(s.tokens.out / 1000).toFixed(1)}k out
      </div>
      <div className="mt-auto pb-1 text-[10px] tabular-nums text-stone-600">{ago(s.lastActivityTs, nowMs)}</div>
    </div>
  )
}
