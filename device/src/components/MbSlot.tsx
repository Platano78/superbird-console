import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { GaugeArc } from './GaugeArc'
import type { DeviceInfoState } from '../deviceInfo'
import { requestFastPoll } from '../deviceInfo'

// Icons are PLAIN RUNTIME STRINGS, resolved document-relative at render
// time -- NOT ES-module asset imports (see ControlSlot.tsx:5-16 for why
// an asset-URL import statement blank-screens this Chromium 69 kiosk).
function iconUrl(file: string) {
  return `./icons/${file}`
}

// Absolute-fill layers for the art + scrim -- explicit top/right/bottom/left,
// not `inset`, matching ControlSlot.tsx:228-232.
const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }

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
  { key: 'chat', label: 'CHAT', actionId: 'mb.profile.chat', icons: { active: 'icon_mb_chat_active.png', inactive: 'icon_mb_chat_inactive.png' } },
  { key: 'prod', label: 'PROD', actionId: 'mb.profile.prod', icons: { active: 'icon_mb_prod_active.png', inactive: 'icon_mb_prod_inactive.png' } },
  { key: 'pair', label: 'PAIR', actionId: 'mb.profile.pair', icons: { active: 'icon_mb_pair_active.png', inactive: 'icon_mb_pair_inactive.png' } },
  { key: 'leaf-deep', label: 'LEAF-DEEP', actionId: 'mb.profile.leaf-deep', icons: { active: 'icon_mb_leaf-deep_active.png', inactive: 'icon_mb_leaf-deep_inactive.png' } },
  { key: 'herald', labelBase: 'HERALD', actionIdSum: 'mb.herald.summon', actionIdDismiss: 'mb.herald.dismiss', icons: { active: 'icon_mb_herald_active.png', inactive: 'icon_mb_herald_inactive.png' } },
  { key: 'pcreate', labelBase: 'PCREATE', actionIdStart: 'mb.pcreate.start', actionIdStop: 'mb.pcreate.stop', icons: { active: 'icon_mb_pcreate_active.png', inactive: 'icon_mb_pcreate_inactive.png' } },
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
          const isLeaf-deep = tile.key === 'leaf-deep'
          const isHerald = tile.key === 'herald'
          const isPcreate = tile.key === 'pcreate'

          const isActive = (isChat && currentProfile === 'chat')
            || (isProd && currentProfile === 'prod')
            || (isPair && currentProfile === 'pair')
            || (isLeaf-deep && currentProfile === 'leaf-deep')
            || (isHerald && mb.herald)
            || (isPcreate && mb.pcreate)

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
          // Tone precedence pending > active > idle, mirroring ControlSlot's
          // TONE_STYLE alphas -- border AND scrim alpha both follow it.
          const borderCls = isPending ? 'border-amber-400' : isActive ? 'border-emerald-400' : 'border-stone-800'
          const scrimAlpha = isPending ? 0.4 : isActive ? 0.45 : 0.68
          const art = isActive ? tile.icons.active : tile.icons.inactive
          // Only PROFILE tiles go inert when active (re-flipping to the current
          // profile is a no-op). Herald/pcreate tiles stay tappable when active
          // -- active IS the state where DISMISS/STOP must fire.
          const isInert = isActive && !isHerald && !isPcreate

          return (
            <div
              key={tile.key}
              className={`relative flex flex-col items-center justify-center overflow-hidden border rounded ${borderCls} ${isInert ? 'cursor-default' : 'cursor-pointer'}`}
              onClick={() => {
                if (isInert) return
                if (tap(actionId)) fireAction(actionId)
              }}
            >
              <img src={iconUrl(art)} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
              <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${scrimAlpha})` }} />
              <div className="relative text-sm font-semibold uppercase tracking-widest text-stone-200">{displayLabel}</div>
              {isPending && (
                <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-amber-400">TAP AGAIN</div>
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
