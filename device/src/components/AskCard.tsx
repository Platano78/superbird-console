import type { Ask } from '../protocol'

type Props = {
  ask: Ask
  nowMs: number
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void
  onQuestion: (id: string, optionIndex: number) => void
}

/**
 * A pending ask takes the whole screen. The device exists to answer these.
 *
 * MUST branch on `kind`: the queue merges permissions and questions, and they
 * take different daemon methods. Answering a question with the permission
 * method silently does nothing — the bridge just returns false for an id it
 * has never seen, and the card sits there while taps appear to do nothing.
 *
 * The countdown reads timeoutMs off the ask itself, never a constant: upstream's
 * doc says 55s while the daemon holds ~595s, so a hard-coded figure expires the
 * prompt ~10x early while the session is still genuinely waiting.
 */
export function AskCard({ ask, nowMs, onPermission, onQuestion }: Props) {
  const isQuestion = ask.kind === 'question'
  // Questions carry no timeoutMs — they live until the terminal prompt goes.
  // Rendering a countdown for them produced NaN:NaN on the device.
  const left =
    ask.timeoutMs === undefined
      ? null
      : Math.max(0, Math.round((ask.timeoutMs - (nowMs - ask.createdTs)) / 1000))
  const urgent = left !== null && left <= 60

  return (
    <div className="flex h-full w-full flex-col justify-between p-5">
      <div className="min-h-0">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold text-amber-300">{ask.sessionName}</span>
          <span className="flex items-center gap-3">
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-400">
              {/* questions carry their own header (already uppercased upstream) */}
              {ask.header ?? ask.kind}
            </span>
            {left !== null && (
              <span className={`text-lg tabular-nums ${urgent ? 'text-red-400' : 'text-neutral-400'}`}>
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </span>
            )}
          </span>
        </div>
        <div className="mt-2 text-3xl font-bold text-white">
          {/* questions put their text in `question`; only permissions have `summary` */}
          {isQuestion ? (ask.question ?? 'Question') : (ask.tool ?? 'Permission')}
        </div>
        {!isQuestion && ask.summary && (
          <div className="mt-1 truncate text-lg text-neutral-300">{ask.summary}</div>
        )}
      </div>

      {isQuestion ? (
        <div className="grid grid-cols-2 gap-3">
          {(ask.options ?? []).map((opt, i) => (
            <button
              key={i}
              onClick={() => onQuestion(ask.id, i)}
              className="rounded-xl bg-neutral-800 p-3 text-left active:bg-neutral-700"
            >
              <div className="text-lg font-semibold text-white">{opt.label}</div>
              {opt.description && (
                <div className="truncate text-sm text-neutral-400">{opt.description}</div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-4">
          <button
            onClick={() => onPermission(ask.id, 'deny')}
            className="h-24 flex-1 rounded-2xl bg-neutral-800 text-2xl font-semibold text-neutral-200 active:bg-neutral-700"
          >
            Deny
          </button>
          <button
            onClick={() => onPermission(ask.id, 'allow')}
            className="h-24 flex-[2] rounded-2xl bg-emerald-600 text-3xl font-bold text-white active:bg-emerald-500"
          >
            Allow
          </button>
        </div>
      )}
    </div>
  )
}
