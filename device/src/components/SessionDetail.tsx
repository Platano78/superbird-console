import type { ReactNode } from 'react'
import type { Ask, SessionSummary } from '../protocol'
import type { FlashTarget } from '../useHardwareKeys'
import { AskCard } from './AskCard'
import { ago } from './SessionGrid'

type Props = {
  session: SessionSummary
  /** The ask currently in the daemon's queue for this session, if any. */
  liveAsk: Ask | undefined
  /** The last ask this device ever saw for this session, kept after it left
   *  the queue — see the cache in daemon.ts. */
  cachedAsk: Ask | undefined
  nowMs: number
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void
  flash: FlashTarget | null
  /** Closes the detail — Escape drives this too, but touch is how this
   *  device is normally used, so a tap target is required, not optional. */
  onClose: () => void
}

/**
 * Opened by tapping a session tile. Routes to the most useful thing this
 * session can show, in priority order: a live ask (fully answerable — AskCard
 * itself decides interactive vs. read-only by `kind`) beats a cached one
 * (read-only, it already expired from the queue) beats a plain summary.
 *
 * A pending ask always wins over this view (App.tsx closes it the instant one
 * arrives), so `liveAsk` here is normally a same-render transient on its way
 * to the top-level auto-popup — kept for correctness, not the common case.
 */
export function SessionDetail({ session, liveAsk, cachedAsk, nowMs, onPermission, flash, onClose }: Props) {
  let body: ReactNode
  if (liveAsk) {
    body = <AskCard ask={liveAsk} nowMs={nowMs} onPermission={onPermission} flash={flash} />
  } else if (session.pendingPermission && cachedAsk) {
    body = <AskCard ask={cachedAsk} nowMs={nowMs} onPermission={onPermission} flash={null} readOnly />
  } else if (session.state === 'attention' && !session.pendingPermission) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
        <div className="text-xl font-semibold text-amber-300">{session.name}</div>
        <div className="text-3xl font-bold text-white">Waiting for your prompt</div>
        <div className="text-sm uppercase tracking-wide text-neutral-500">Answer in the terminal</div>
      </div>
    )
  } else {
    const pct = session.context === null ? null : Math.round(session.context * 100)
    body = (
      <div className="flex h-full flex-col justify-between p-5">
        <div>
          <div className="text-xl font-semibold text-white">{session.name}</div>
          <div className="mt-1 text-sm uppercase tracking-wide text-neutral-500">{session.state}</div>
        </div>
        <div className="text-3xl font-light tabular-nums text-white/80">{ago(session.lastActivityTs, nowMs)}</div>
        <div className="text-sm">
          {pct !== null && <div className="mb-2 tabular-nums text-neutral-400">{pct}% ctx</div>}
          <div className="tabular-nums text-neutral-500">
            {(session.tokens.in / 1000).toFixed(1)}k in · {(session.tokens.out / 1000).toFixed(1)}k out
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col">
      <button
        onClick={onClose}
        className="flex items-center gap-1 px-4 py-2 text-left text-sm text-neutral-500 active:text-neutral-300"
      >
        ‹ Back
      </button>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}
