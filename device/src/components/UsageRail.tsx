import type { Usage } from '../protocol'

/**
 * Persistent plan-limit rail styled as three instrument tapes — same
 * always-on rationale as before: glanceability, no interaction required.
 */

/** Colour encodes headroom, not decoration. Amber earns attention; red means act. */
function tone(used: number) {
  if (used >= 0.9) return { bar: 'bg-red-500', text: 'text-red-300' }
  if (used >= 0.75) return { bar: 'bg-amber-400', text: 'text-amber-300' }
  return { bar: 'bg-emerald-500', text: 'text-stone-300' }
}

export function UsageRail({ usage }: { usage: Usage | null }) {
  const limits = usage?.limits
  // Hide rather than show a broken rail: usage goes {stale:true} whenever
  // `claude -p "/usage"` cannot be parsed.
  if (!limits || limits.length === 0) return null

  return (
    <footer
      className="h-[58px] shrink-0 border-t border-stone-800 bg-stone-950 px-2 py-1.5"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${limits.length}, 1fr)`, gap: 12 }}
    >
      {limits.map((l) => {
        const pct = Math.round(l.used * 100)
        const t = tone(l.used)
        return (
          <div key={l.key} className="min-w-0 border-l border-stone-800 pl-2 first:border-l-0 first:pl-0">
            <div className="flex items-baseline justify-between">
              <span className="truncate text-[10px] uppercase tracking-wider text-stone-400">{l.label}</span>
              <span className={`shrink-0 pl-2 text-sm font-semibold tabular-nums ${t.text}`}>{pct}%</span>
            </div>
            {/* the "tape": a visible track with a clearly filled bar — the
                75/90 thresholds already read through the tone colour change,
                so no tick overlay here (it didn't read cleanly at this size). */}
            <div className="mt-1 h-3.5 w-full overflow-hidden rounded-sm border border-stone-700 bg-stone-800">
              <div
                className={`h-full ${t.bar} transition-[width] duration-700 ease-out`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <div className="mt-0.5 truncate text-[9px] text-stone-600">{l.detail}</div>
          </div>
        )
      })}
    </footer>
  )
}
