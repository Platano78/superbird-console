import type { SessionSummary } from '../protocol'

const STATE_COLOR: Record<SessionSummary['state'], string> = {
  attention: 'border-amber-400 bg-amber-950',
  busy: 'border-sky-500 bg-sky-950',
  celebrate: 'border-emerald-500 bg-emerald-950',
  idle: 'border-neutral-700 bg-neutral-900',
}

/**
 * Resting view: every live session at a glance. Scrolls sideways because the
 * daemon's snapshot is unbounded — it sends all sessions, not a capped page.
 */
export function SessionGrid({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-2xl text-neutral-500">
        No active sessions
      </div>
    )
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`flex h-full w-56 shrink-0 flex-col justify-between rounded-xl border-2 p-4 ${STATE_COLOR[s.state]}`}
        >
          <div>
            <div className="truncate text-xl font-semibold text-white">{s.name}</div>
            <div className="mt-1 text-sm uppercase tracking-wide text-neutral-400">{s.state}</div>
          </div>
          <div className="text-sm text-neutral-300">
            {/* context is 0..1 or null — null means the daemon has no reading yet */}
            {s.context !== null && (
              <div className="mb-2">
                <div className="h-2 w-full rounded bg-neutral-800">
                  <div
                    className="h-2 rounded bg-neutral-300"
                    style={{ width: `${Math.round(s.context * 100)}%` }}
                  />
                </div>
                <div className="mt-1 tabular-nums">{Math.round(s.context * 100)}% ctx</div>
              </div>
            )}
            <div className="tabular-nums text-neutral-400">
              {(s.tokens.in / 1000).toFixed(1)}k in · {(s.tokens.out / 1000).toFixed(1)}k out
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
