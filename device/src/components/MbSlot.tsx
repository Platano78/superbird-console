import { useEffect, useRef, useState } from 'react'
import { GaugeArc } from './GaugeArc'
import type { DeviceInfoState } from '../deviceInfo'
import { requestFastPoll } from '../deviceInfo'

const ACTION_URL = 'http://127.0.0.1:8791/action'
const CONFIRM_TIMEOUT_MS = 4000

/** Local confirm-arming hook — mirrors ControlSlot.tsx:144-168 shape:
 * single `pending` id + single 4s timer. Purely about arm/timeout state. */
function useConfirm() {
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

type Props = { info: DeviceInfoState | null; reachable: boolean }

const TILE_DEFS = [
  { key: 'chat', label: 'CHAT', actionId: 'mb.profile.chat' },
  { key: 'prod', label: 'PROD', actionId: 'mb.profile.prod' },
  { key: 'pair', label: 'PAIR', actionId: 'mb.profile.pair' },
  { key: 'dsv4f', label: 'DSV4F', actionId: 'mb.profile.dsv4f' },
  { key: 'herald', labelBase: 'HERALD', actionIdSum: 'mb.herald.summon', actionIdDismiss: 'mb.herald.dismiss' },
  { key: 'pcreate', labelBase: 'PCREATE', actionIdStart: 'mb.pcreate.start', actionIdStop: 'mb.pcreate.stop' },
]

/** Fire an action: fast-poll then POST — fire-and-forget. */
function fireAction(id: string) {
  requestFastPoll()
  void fetch(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

/** Slot 3 -- fleet-host profile switcher. */
export function MbSlot({ info, reachable }: Props) {
  const { pending, tap } = useConfirm()

  if (!reachable || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">FLEET-HOST</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }

  const mb = info.mb

  // Switching view — replaces the whole grid. MUST be checked BEFORE the
  // unreachable branch: mid-flip both fleet-host ports are down by design
  // (profile.sh stop_all), so reachable:false is the EXPECTED state of a
  // switch in progress — showing "unreachable" then would report a deliberate
  // action as an outage (observed on hardware, first live flip 2026-08-13).
  if (mb.switching) {
    const { target, phase, elapsedMs } = mb.switching
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-xl font-semibold text-amber-400">SWITCHING → {target.toUpperCase()}</div>
        <div className="mt-2 text-sm text-amber-400">{phase} · {Math.round(elapsedMs / 1000)}s</div>
      </div>
    )
  }

  if (!mb.reachable) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">FLEET-HOST</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">fleet-host unreachable</div>
      </div>
    )
  }

  const currentProfile = mb.profile
  const profileLabel = currentProfile ? currentProfile.toUpperCase() : '--'

  return (
    <div className="flex h-full flex-col" style={{ padding: '8px 12px' }}>
      {/* Header strip */}
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-3xl font-bold uppercase tracking-widest text-stone-50">{profileLabel}</div>
        <div className="flex">
          {mb.herald && (
            <div className="ml-2 rounded bg-stone-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-stone-400">HERALD</div>
          )}
          {mb.pcreate && (
            <div className="ml-2 rounded bg-stone-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-stone-400">PCREATE</div>
          )}
        </div>
      </div>

      {/* Tile grid: 3 cols × 2 rows */}
      <div className="flex-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
        {TILE_DEFS.map((tile) => {
          const isChat = tile.key === 'chat'
          const isProd = tile.key === 'prod'
          const isPair = tile.key === 'pair'
          const isDsv4f = tile.key === 'dsv4f'
          const isHerald = tile.key === 'herald'
          const isPcreate = tile.key === 'pcreate'

          const isActive = (isChat && currentProfile === 'chat')
            || (isProd && currentProfile === 'prod')
            || (isPair && currentProfile === 'pair')
            || (isDsv4f && currentProfile === 'dsv4f')

          const actionId = isHerald
            ? (mb.herald ? tile.actionIdDismiss! : tile.actionIdSum!)
            : isPcreate
              ? (mb.pcreate ? tile.actionIdStop! : tile.actionIdStart!)
              : (tile as { actionId: string }).actionId

          const displayLabel = isHerald
            ? (mb.herald ? 'DISMISS' : 'SUMMON')
            : isPcreate
              ? (mb.pcreate ? 'STOP' : 'START')
              : (tile as { label: string }).label

          const isPending = pending === actionId
          const borderCls = isPending
            ? 'border-amber-400'
            : isActive
              ? 'border-emerald-400'
              : 'border-stone-800'

          return (
            <div
              key={tile.key}
              className={`flex flex-col items-center justify-center border rounded ${borderCls} ${isActive ? 'cursor-default' : 'cursor-pointer'}`}
              onClick={() => {
                if (isActive) return
                if (tap(actionId)) fireAction(actionId)
              }}
            >
              <div className="text-sm font-semibold uppercase tracking-widest text-stone-200">{displayLabel}</div>
              {isPending && (
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-amber-400">TAP AGAIN</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Error line */}
      {mb.lastResult && !mb.lastResult.ok && (
        <div className="shrink-0 border-t border-stone-800 pt-1 text-center text-[11px] text-red-400">
          {mb.lastResult.id} failed: {mb.lastResult.error ?? 'unknown'}
        </div>
      )}
    </div>
  )
}
