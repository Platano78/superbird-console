/**
 * Inert-action feedback (owner ruling 4). In demo mode a tap must NOT POST
 * anywhere, but silence on this device reads as broken hardware -- so every
 * suppressed action publishes a short notice instead, rendered by
 * DemoToast.tsx.
 *
 * A tiny module-level channel rather than context: the callers are plain
 * functions (fleet/shared.ts `fireAction`, ControlSlot.tsx `postAction`),
 * not components.
 */

import { useEffect, useState } from 'react'
import { isDemoActive } from './demoMode'

export type InertNotice = { id: number; text: string }

let seq = 0
let current: InertNotice | null = null
const subscribers = new Set<() => void>()

/** Returns true when the action was swallowed (demo on) -- callers use the
 *  return value as their early-out. No-op and false in real mode. */
export function inertAction(label: string): boolean {
  if (!isDemoActive()) return false
  current = { id: ++seq, text: `DEMO — action not sent: ${label}` }
  subscribers.forEach((fn) => fn())
  return true
}

const NOTICE_MS = 2600

export function useInertNotice(): InertNotice | null {
  const [notice, setNotice] = useState<InertNotice | null>(current)

  useEffect(() => {
    const fn = () => setNotice(current)
    subscribers.add(fn)
    return () => {
      subscribers.delete(fn)
    }
  }, [])

  // Keyed on the notice's own id -- a locally-generated counter that only
  // advances on a user tap, never on poll-produced state.
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => {
      if (current && current.id === notice.id) current = null
      setNotice(null)
    }, NOTICE_MS)
    return () => window.clearTimeout(t)
  }, [notice?.id])

  return notice
}
