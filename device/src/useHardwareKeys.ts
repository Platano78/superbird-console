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
const BOUND_CODES = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Enter'])

function klog(e: KeyboardEvent, action: string) {
  const log = (window.__klog ??= [])
  log.push({ code: e.code, key: e.key, repeat: e.repeat, t: Date.now(), action })
  if (log.length > KLOG_MAX) log.splice(0, log.length - KLOG_MAX)
}

export type FlashTarget = { decision: 'allow' | 'deny' }
export type KeyAction = { type: 'allow' } | { type: 'deny' } | { type: 'noop' }

/**
 * Pure decision logic, no side effects or timing guards — independently
 * checkable. Questions are read-only on this device (see AskCard —
 * `claude.question.answer` only works via macOS AppleScript, which doesn't
 * exist here), so they always resolve to noop; only permissions are
 * hardware-answerable.
 */
export function resolveKeyAction(code: string, ask: Ask | undefined): KeyAction {
  if (!ask || ask.kind === 'question') return { type: 'noop' }
  if (code === 'Digit1' || code === 'Enter') return { type: 'allow' }
  if (code === 'Digit4') return { type: 'deny' }
  return { type: 'noop' }
}

type Params = {
  ask: Ask | undefined
  onPermission: (requestId: string, decision: 'allow' | 'deny') => void
  /** Whether a session-detail view is currently open — Escape closes it. */
  hasOpenDetail: boolean
  onEscape: () => void
}

/**
 * Binds the seven physical keys the gpio-keys handler can emit. Registers one
 * `window` listener for the component's lifetime — everything it reads lives
 * in refs so the effect's dependency list stays `[]`. An effect keyed on
 * changing state caused React #185 (max update depth) on this device (see
 * App.tsx); don't repeat that here.
 */
export function useHardwareKeys({ ask, onPermission, hasOpenDetail, onEscape }: Params): FlashTarget | null {
  const askRef = useRef(ask)
  askRef.current = ask
  const onPermissionRef = useRef(onPermission)
  onPermissionRef.current = onPermission
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  const hasOpenDetailRef = useRef(hasOpenDetail)
  hasOpenDetailRef.current = hasOpenDetail

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

      // Closing a view cannot grant a tool call, so Escape bypasses every
      // ask-answering guard below — it has its own, independent path.
      if (event.code === 'Escape') {
        if (!hasOpenDetailRef.current) return klog(event, 'noop')
        event.preventDefault()
        onEscapeRef.current()
        return klog(event, 'close-detail')
      }

      if (!BOUND_CODES.has(event.code)) return klog(event, 'noop') // KeyM: deliberately unbound

      const currentAsk = askRef.current
      if (!currentAsk) return klog(event, 'noop:no-ask')
      if (Date.now() - armedAtRef.current < ARM_DELAY_MS) return klog(event, 'ignored:arming')
      if (answeredIdRef.current === currentAsk.id) return klog(event, 'ignored:already-answered')

      const action = resolveKeyAction(event.code, currentAsk)
      if (action.type === 'noop') {
        return klog(event, currentAsk.kind === 'question' ? 'noop:question-readonly' : 'noop')
      }

      event.preventDefault()
      answeredIdRef.current = currentAsk.id
      clearTimeout(flashTimerRef.current)

      klog(event, action.type)
      setFlash({ decision: action.type })
      onPermissionRef.current(currentAsk.id, action.type)
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
