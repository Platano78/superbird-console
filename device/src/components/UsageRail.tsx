import type { Usage } from '../protocol'

/**
 * Persistent plan-limit rail: the 5h session window, the weekly all-models
 * limit, and the per-model weekly limit (Fable).
 *
 * Deliberately always-on rather than behind navigation — the dial and preset
 * buttons are not confirmed to reach the web layer, and on a desk device the
 * whole value is glanceability. No interaction required.
 */

/** Colour encodes headroom, not decoration. Amber earns attention; red means act. */
function tone(used: number) {
  if (used >= 0.9) return { bar: 'bg-red-500', text: 'text-red-300' }
  if (used >= 0.75) return { bar: 'bg-amber-400', text: 'text-amber-300' }
  return { bar: 'bg-emerald-500', text: 'text-neutral-300' }
}

export function UsageRail({ usage }: { usage: Usage | null }) {
  const limits = usage?.limits
  // Hide rather than show a broken rail: usage goes {stale:true} whenever
  // `claude -p "/usage"` cannot be parsed.
  if (!limits || limits.length === 0) return null

  return (
    // Generous gap + a divider: without them each column's % reads as if it
    // belongs to the NEXT column's label ("43%WEEK · ALL MODELS").
    <footer className="flex shrink-0 divide-x divide-neutral-800 border-t border-neutral-800">
      {limits.map((l) => {
        const pct = Math.round(l.used * 100)
        const t = tone(l.used)
        return (
          <div key={l.key} className="min-w-0 flex-1 px-4 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[10px] uppercase tracking-wider text-neutral-500">
                {l.label}
              </span>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.text}`}>{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
              {/* width transition is the only motion here — it fires when a
                  limit actually moves, so movement always means something */}
              <div
                className={`h-full rounded-full ${t.bar} transition-[width] duration-700 ease-out`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            <div className="mt-0.5 truncate text-[10px] text-neutral-600">{l.detail}</div>
          </div>
        )
      })}
    </footer>
  )
}
