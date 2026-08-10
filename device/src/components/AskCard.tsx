import type { Ask } from '../protocol'
import type { FlashTarget } from '../useHardwareKeys'

type Props = {
  ask: Ask
  nowMs: number
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void
  /** The control a hardware key press just triggered — briefly highlighted so a
   *  physical press gets the same visible confirmation a tap does. */
  flash?: FlashTarget | null
  /** True when `ask` is no longer live — e.g. a session-detail view showing the
   *  last-seen ask after it expired from the queue. No buttons, just what it
   *  was and a pointer to the terminal. */
  readOnly?: boolean
}

/**
 * A pending ask takes the whole screen. The device exists to answer these —
 * except questions, which are display-only here: `claude.question.answer`
 * drives AppleScript on macOS to type into Terminal.app, so nothing on this
 * device can actually answer one (confirmed live: two answers sent, neither
 * took effect, only resolved 42s later from the terminal).
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
export function AskCard({ ask, nowMs, onPermission, flash, readOnly = false }: Props) {
  const isQuestion = ask.kind === 'question'
  // Questions carry no timeoutMs — they live until the terminal prompt goes.
  // Rendering a countdown for them produced NaN:NaN on the device.
  const left =
    ask.timeoutMs === undefined
      ? null
      : Math.max(0, Math.round((ask.timeoutMs - (nowMs - ask.createdTs)) / 1000))
  const urgent = left !== null && left <= 60

  return (
    // riseIn fires once per ask (keyed on id) — the motion IS the notification.
    <div key={ask.id} className="flex h-full w-full animate-riseIn flex-col justify-between p-5">
      <div className="min-h-0">
        <div className="flex items-baseline justify-between">
          <span className="text-xl font-semibold text-amber-300">{ask.sessionName}</span>
          <span className="flex items-center">
            <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs uppercase tracking-wide text-neutral-400">
              {/* questions carry their own header (already uppercased upstream) */}
              {ask.header ?? ask.kind}
            </span>
            {left !== null && (
              <span className={`ml-3 text-lg tabular-nums ${urgent ? 'text-red-400' : 'text-neutral-400'}`}>
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
        // Read-only: this device cannot drive claude.question.answer (macOS
        // AppleScript only) — see the note above. Buttons that provably
        // cannot work are worse than no buttons.
        <div>
          <div className="grid grid-cols-2 gap-3">
            {(ask.options ?? []).map((opt, i) => (
              <div key={i} className="rounded-xl bg-neutral-800/60 p-3 text-left opacity-70">
                <div className="text-lg font-semibold text-white">{opt.label}</div>
                {opt.description && (
                  <div className="truncate text-sm text-neutral-400">{opt.description}</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 text-center text-sm uppercase tracking-wide text-neutral-500">
            Answer in the terminal
          </div>
        </div>
      ) : readOnly ? (
        <div className="rounded-xl bg-neutral-800/60 p-4 text-center text-lg text-neutral-400">
          This request expired — answer in the terminal
        </div>
      ) : (
        <div className="flex">
          <button
            onClick={() => onPermission(ask.id, 'deny')}
            className={`h-24 flex-1 rounded-2xl bg-neutral-800 text-2xl font-semibold text-neutral-200 active:bg-neutral-700 ${
              flash?.decision === 'deny' ? 'ring-2 ring-white' : ''
            }`}
          >
            Deny
          </button>
          <button
            onClick={() => onPermission(ask.id, 'allow')}
            className={`ml-4 h-24 flex-[2] rounded-2xl bg-emerald-600 text-3xl font-bold text-white active:bg-emerald-500 ${
              flash?.decision === 'allow' ? 'ring-2 ring-white' : ''
            }`}
          >
            Allow
          </button>
        </div>
      )}
    </div>
  )
}
