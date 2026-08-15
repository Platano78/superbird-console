/**
 * Persistent failure banner (Ruling 13, on-screen half) -- rendered below
 * the active page on every page, survives a page change, and only leaves
 * the screen on an explicit dismiss (never a timer, never the next action
 * overwriting it). Dismiss is reachable by touch (tap the banner) and by
 * the cursor/confirm path -- `isCursor` drives the same highlight every
 * other confirmable tile uses, and MbSlot's onConfirm routes the dial's
 * Enter to `dismiss` when the cursor is on this slot (see MbSlot.tsx).
 */
export function FailureBanner({
  id,
  error,
  isCursor,
  onDismiss,
}: {
  id: string
  error?: string
  isCursor: boolean
  onDismiss: () => void
}) {
  return (
    <div
      className={`mt-2 flex shrink-0 cursor-pointer items-center justify-between rounded border-2 bg-stone-950 px-2 py-1 ${isCursor ? 'border-sky-400' : 'border-red-600'}`}
      onClick={onDismiss}
    >
      <div className="min-w-0 truncate text-[11px] text-red-400">
        {id} failed: {error ?? 'unknown'}
      </div>
      <div className="ml-2 shrink-0 text-[10px] font-bold uppercase tracking-widest text-red-300">✕ DISMISS</div>
    </div>
  )
}
