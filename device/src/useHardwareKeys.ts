import { useEffect, useRef, useState } from 'react'
import type { Ask } from './protocol'

/** Bounded ring buffer read over CDP (Runtime.evaluate) — the only debugging
 *  feedback loop for this always-on device. Capped so it never grows unbounded. */
declare global {
  interface Window { __klog?: KlogEntry[] }
}
export type KlogEntry = { code: string; key: string; repeat: boolean; t: number; action: string }

const KLOG_MAX = 50
const ARM_DELAY_MS = 250
const DIGIT_INDEX: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }
const BOUND_CODES = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Enter'])

function klog(e: KeyboardEvent, action: string) {
  const log = (window.__klog ??= [])
  log.push({ code: e.code, key: e.key, repeat: e.repeat, t: Date.now(), action })
  if (log.length > KLOG_MAX) log.splice(0, log.length - KLOG_MAX)
}

export type FlashTarget = { kind: 'permission'; decision: 'allow' | 'deny' } | { kind: 'option'; index: number }
export type KeyAction = { type: 'allow' } | { type: 'deny' } | { type: 'noop' } | { type: 'option'; index: number }

/** Pure decision logic, no side effects or timing guards — independently checkable. */
export function resolveKeyAction(code: string, ask: Ask | undefined): KeyAction {
  if (!ask) return { type: 'noop' }
  if (ask.kind === 'permission') {
    if (code === 'Digit1' || code === 'Enter') return { type: 'allow' }
    if (code === 'Digit4') return { type: 'deny' }
    return { type: 'noop' }
  }
  const options = ask.options ?? []
  const index = code === 'Enter' ? 0 : DIGIT_INDEX[code]
  return index !== undefined && options[index] ? { type: 'option', index } : { type: 'noop' }
}

type Params = {
  ask: Ask | undefined
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void
  onQuestion: (id: string, optionIndex: number) => void
}

/**
 * Binds the seven physical keys the gpio-keys handler can emit. Registers one
 * `window` listener for the component's lifetime — everything it reads lives
 * in refs so the effect's dependency list stays `[]`. An effect keyed on
 * changing state caused React #185 (max update depth) on this device (see
 * App.tsx); don't repeat that here.
 */
export function useHardwareKeys({ ask, onPermission, onQuestion }: Params): FlashTarget | null {
  const askRef = useRef(ask)
  askRef.current = ask
  const callbacksRef = useRef({ onPermission, onQuestion })
  callbacksRef.current = { onPermission, onQuestion }

  // First-seen time and answered-state for the CURRENT ask id; both reset
  // only when the id changes (tracked via a ref, not an effect dependency).
  const armedAtRef = useRef(Date.now())
  const answeredIdRef = useRef<string | null>(null)
  const currentIdRef = useRef(ask?.id)
  if (currentIdRef.current !== ask?.id) {
    currentIdRef.current = ask?.id
    armedAtRef.current = Date.now()
    answeredIdRef.current = null
  }

  const [flash, setFlash] = useState<FlashTarget | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return klog(event, 'ignored:repeat')
      if (!BOUND_CODES.has(event.code)) return klog(event, 'noop') // Escape/KeyM: deliberately unbound

      const currentAsk = askRef.current
      if (!currentAsk) return klog(event, 'noop:no-ask')
      if (Date.now() - armedAtRef.current < ARM_DELAY_MS) return klog(event, 'ignored:arming')
      if (answeredIdRef.current === currentAsk.id) return klog(event, 'ignored:already-answered')

      const action = resolveKeyAction(event.code, currentAsk)
      if (action.type === 'noop') return klog(event, 'noop')

      event.preventDefault()
      answeredIdRef.current = currentAsk.id
      clearTimeout(flashTimerRef.current)

      if (action.type === 'allow' || action.type === 'deny') {
        klog(event, action.type)
        setFlash({ kind: 'permission', decision: action.type })
        callbacksRef.current.onPermission(currentAsk.id, action.type)
      } else {
        klog(event, `option:${action.index}`)
        setFlash({ kind: 'option', index: action.index })
        callbacksRef.current.onQuestion(currentAsk.id, action.index)
      }
      flashTimerRef.current = setTimeout(() => setFlash(null), 150)
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      clearTimeout(flashTimerRef.current)
    }
  }, [])

  return flash
}
