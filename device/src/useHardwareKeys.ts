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
const BOUND_CODES = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Enter', 'ArrowUp', 'ArrowDown', 'KeyM'])
/** Digit1..4 double as the four physical preset buttons when no ask is
 *  pending — Enter (the dial press) is deliberately excluded, it is not a
 *  preset button. ArrowUp/ArrowDown (dial rotation, once Phase A's bridge
 *  lands) and KeyM (the M/front button) are fleet-nav-only and routed to
 *  onNav/onPage below, same no-ask-only guard. */
const SLOT_BY_CODE: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4 }

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
  /** Currently active preset slot (1-4) — read to skip a same-slot press. */
  activeSlot: number
  /** Digit1..4 switch slots, but ONLY when no ask is pending (see the
   *  ask-always-wins guard below). Never called for the currently active slot. */
  onSlotChange: (slot: number) => void
  /** ArrowUp/ArrowDown (dial rotation) — no-ask branch only, like everything
   *  else here. Optional so a page that doesn't wire fleet nav still compiles. */
  onNav?: (dir: 'up' | 'down') => void
  /** KeyM (the M/front button) — no-ask branch only. Optional, see onNav. */
  onPage?: () => void
  /** Enter, no-ask branch only — replaces the old noop:dial-no-ask return.
   *  With an ask pending, Enter stays Allow via resolveKeyAction, untouched. */
  onConfirm?: () => void
}

/**
 * Binds the seven physical keys the gpio-keys handler can emit. Registers one
 * `window` listener for the component's lifetime — everything it reads lives
 * in refs so the effect's dependency list stays `[]`. An effect keyed on
 * changing state caused React #185 (max update depth) on this device (see
 * App.tsx); don't repeat that here.
 */
export function useHardwareKeys({
  ask,
  onPermission,
  hasOpenDetail,
  onEscape,
  activeSlot,
  onSlotChange,
  onNav,
  onPage,
  onConfirm,
}: Params): FlashTarget | null {
  const askRef = useRef(ask)
  askRef.current = ask
  const onPermissionRef = useRef(onPermission)
  onPermissionRef.current = onPermission
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape
  const hasOpenDetailRef = useRef(hasOpenDetail)
  hasOpenDetailRef.current = hasOpenDetail
  const activeSlotRef = useRef(activeSlot)
  activeSlotRef.current = activeSlot
  const onSlotChangeRef = useRef(onSlotChange)
  onSlotChangeRef.current = onSlotChange
  const onNavRef = useRef(onNav)
  onNavRef.current = onNav
  const onPageRef = useRef(onPage)
  onPageRef.current = onPage
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm

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

      if (!BOUND_CODES.has(event.code)) return klog(event, 'noop')

      const currentAsk = askRef.current
      if (!currentAsk) {
        // Ask always wins — this whole branch is reachable ONLY when there is
        // no pending ask, which is what makes every fleet-nav binding below
        // safe. With nothing pending: Digit1..4 are the four preset buttons,
        // Enter (dial press) confirms the fleet cursor, ArrowUp/ArrowDown
        // (dial rotation, via Phase A's bridge) move it, and KeyM pages.
        // With an ask pending, control never reaches here: Enter/Digit1 mean
        // Allow and Digit4 means Deny, via resolveKeyAction below.
        // Neither the arm delay nor the answered-id guard applies to this
        // path — there is no misfire risk in changing a view, only in
        // granting a tool call.
        if (event.code === 'Enter') {
          event.preventDefault()
          onConfirmRef.current?.()
          return klog(event, 'nav:confirm')
        }
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          event.preventDefault()
          const dir = event.code === 'ArrowUp' ? 'up' : 'down'
          onNavRef.current?.(dir)
          return klog(event, `nav:${dir}`)
        }
        if (event.code === 'KeyM') {
          event.preventDefault()
          onPageRef.current?.()
          return klog(event, 'nav:page')
        }
        const slot = SLOT_BY_CODE[event.code]
        if (slot === activeSlotRef.current) return klog(event, 'noop:slot-unchanged')
        event.preventDefault()
        onSlotChangeRef.current(slot)
        return klog(event, `slot:${slot}`)
      }
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
