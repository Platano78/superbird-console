import { useEffect, useRef, useState } from 'react'

const CONFIRM_TIMEOUT_MS = 4000

/** Two-tap confirm-arming, single `pending` id + single 4s timer -- same
 *  shape as ControlSlot.tsx's useConfirm / the old MbSlot's useConfirm.
 *  One instance shared by MbSlot across BOTH input paths (touch tap and the
 *  dial's Enter-confirm) so a leaf/aux action always needs the same two-step
 *  confirm regardless of what pressed it (Ruling 7: q38h "keeps the
 *  two-step confirm like everything else"). */
export function useConfirmArm() {
  const [pending, setPending] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setPending(null)
  }

  const tap = (id: string): boolean => {
    if (pending === id) {
      cancel()
      return true
    }
    if (timer.current) window.clearTimeout(timer.current)
    setPending(id)
    timer.current = window.setTimeout(cancel, CONFIRM_TIMEOUT_MS)
    return false
  }

  return { pending, tap, cancel }
}
