import { useState } from 'react'
import type { MbState } from '../../deviceInfo'
import { fireAction } from './shared'

/**
 * Feedback tier 1 (Ruling 13): the tapped/confirmed control latches to a
 * visibly committed state the moment the POST fires — never a silent gap
 * before the next poll where a press looks ignored. `requestFastPoll()`
 * (inside fireAction) tightens the DATA loop; this hook is the VISUAL one,
 * and must not wait on it.
 *
 * `isLatched` is a pure derivation at render time off the current `mb` —
 * "the server caught up" (mb.switching went non-null, or lastResult's id
 * matches) simply makes it read false again. There is nothing to clear via
 * an effect, so this hook owns no effects and never keys one on poll-
 * produced state (the React #185 trap this device has already hit once).
 */
export function useFireLatch(mb: MbState | null) {
  const [firedId, setFiredId] = useState<string | null>(null)

  const fire = (id: string) => {
    setFiredId(id)
    fireAction(id)
  }

  const isLatched = (id: string): boolean => {
    if (firedId !== id) return false
    if (!mb) return true
    if (mb.switching) return false
    if (mb.lastResult && mb.lastResult.id === id) return false
    return true
  }

  return { fire, isLatched }
}
