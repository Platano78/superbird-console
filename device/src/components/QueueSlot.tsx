import { GaugeArc } from './GaugeArc'
import type { DeviceInfoState, QueueCounts } from '../deviceInfo'

const CELLS: { key: keyof Pick<QueueCounts, 'pending' | 'inProgress' | 'done' | 'review' | 'escalated' | 'failed'>; label: string }[] = [
  { key: 'pending', label: 'pending' },
  { key: 'inProgress', label: 'in progress' },
  { key: 'done', label: 'done' },
  { key: 'review', label: 'review' },
  { key: 'escalated', label: 'escalated' },
  { key: 'failed', label: 'failed' },
]

type Props = { info: DeviceInfoState | null; reachable: boolean }

/** Slot 3 -- the six pi-harness queue depths (pending/failed emphasized), plus the obligations line. */
export function QueueSlot({ info, reachable }: Props) {
  if (!reachable || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">QUEUE</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }
  const { queue } = info
  return (
    <div className="flex h-full flex-col" style={{ padding: '8px 12px' }}>
      <div className="flex-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)' }}>
        {CELLS.map(({ key, label }, i) => {
          const value = queue[key]
          // SIZE encodes "this is the one you scan for"; COLOUR encodes "act on
          // this". They are separate on purpose — pending/failed stay large at
          // all times, but a zero is good news and must not wear an accent.
          // Matches the rule the rest of the app follows: colour is earned only
          // once a value is worth acting on (see ctxTone / UsageRail.tone).
          const emphasized = key === 'pending' || key === 'failed'
          const nonZero = value !== null && value > 0
          const tone =
            key === 'failed' && nonZero ? 'text-red-400'
            : key === 'pending' && nonZero ? 'text-amber-300'
            : 'text-stone-200'
          return (
            <div
              key={key}
              className={`flex flex-col items-center justify-center border-stone-800 ${i >= 3 ? 'border-t' : ''} ${i % 3 !== 0 ? 'border-l' : ''}`}
            >
              <div className={`font-bold tabular-nums ${tone}`} style={{ fontSize: emphasized ? 40 : 28 }}>{value ?? '--'}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-widest text-stone-500">{label}</div>
            </div>
          )
        })}
      </div>
      <div className="shrink-0 border-t border-stone-800 pt-1 text-center text-[11px] tabular-nums text-stone-400">
        {queue.obligations.line ?? queue.obligations.error ?? 'obligations unavailable'}
      </div>
    </div>
  )
}
