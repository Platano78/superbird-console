/**
 * Top bar = the four physical preset buttons' labels + the status lamps,
 * merged into ONE strip touching the top edge. Two fixes bundled into one:
 *
 * 1. The presets are physical buttons on the device's TOP edge; the old
 *    PresetBar rendered at the BOTTOM -- maximum possible distance from the
 *    controls it labels. Moving it to the top fixes that directly.
 * 2. Stacking a plain header above this bar would waste 64px of the 480px
 *    canvas for two strips doing overlapping jobs. Merging them into one
 *    keeps the same lamp/label information in one row's worth of height,
 *    which is vertical space every slot below gets back.
 *
 * The "CLAUDE CODE" wordmark and "N sessions" count are dropped on purpose
 * -- decoration and a number the SESSIONS slot already shows via its own
 * tile count, respectively (owner ruling).
 *
 * Always rendered, never hidden during an ask/detail -- same as the header
 * it replaces. Only the limits rail at the bottom still hides then.
 */

function Lamp({ lit, color, label }: { lit: boolean; color: string; label: string }) {
  return (
    <span className="flex items-center" style={{ marginLeft: 10 }}>
      <span className="h-2 w-2 rounded-full" style={{ background: lit ? color : '#44403c' }} />
      <span className={`ml-1 text-[10px] uppercase tracking-wide ${lit ? 'text-stone-300' : 'text-stone-700'}`}>{label}</span>
    </span>
  )
}

const SLOTS = ['SESSIONS', 'FLEET', 'MB', 'CONTROL']

type Props = {
  activeSlot: number
  onSelect: (slot: number) => void
  limitPressure: boolean
  connected: boolean
  waitingCount: number
  /** 🔴 Fixture data is on screen. The badge below is the ONE thing standing
   *  between a viewer and mistaking demo data for their live fleet, so it
   *  lives in this always-rendered bar (it survives an ask stealing the
   *  screen and every slot change) and is never conditional on the page. */
  demo?: boolean
}

export function TopBar({ activeSlot, onSelect, limitPressure, connected, waitingCount, demo }: Props) {
  return (
    <div
      className="h-[40px] shrink-0 border-b border-stone-800 bg-stone-950"
      style={{ display: 'grid', gridTemplateColumns: `repeat(4, 1fr) auto${demo ? ' auto' : ''}` }}
    >
      {SLOTS.map((label, i) => {
        const slot = i + 1
        const active = slot === activeSlot
        return (
          <div
            key={label}
            role="button"
            onClick={() => onSelect(slot)}
            className={`flex items-center justify-center border-l border-stone-800 text-[11px] font-semibold tracking-wider first:border-l-0 ${
              active ? 'bg-stone-800 text-stone-50' : 'text-stone-500'
            }`}
          >
            {'①②③④'[i]} {label}
          </div>
        )
      })}
      <div className="flex items-center border-l border-stone-800 px-3">
        <Lamp lit={limitPressure} color="#f87171" label="limit" />
        <Lamp lit={connected} color="#34d399" label={connected ? 'online' : 'offline'} />
        {waitingCount > 0 && <span className="ml-3 text-xs text-amber-300">+{waitingCount} waiting</span>}
      </div>
      {demo && (
        <div className="flex items-center border-l border-stone-800 bg-amber-400 px-3 text-[11px] font-bold tracking-widest text-stone-950">
          DEMO
        </div>
      )}
    </div>
  )
}
