import type { FleetHost } from '../../deviceInfo'
import { FILL_STYLE, hostLoading, iconUrl, isReadyForDuty, isUncensoredLeaf, leafDisplayName, orderedFlipTargets, primaryHost } from './shared'

// Existing mb-tile art for the five daily leaves. leaf-mid/leaf-alt have no dedicated
// art yet -- reuse the closest existing set (they're visually distinguished
// by border tone + the RFD/UNCENSORED labels below, not by unique art).
const LEAF_ICONS: Record<string, { active: string; inactive: string }> = {
  chat: { active: 'icon_mb_chat_active.png', inactive: 'icon_mb_chat_inactive.png' },
  prod: { active: 'icon_mb_prod_active.png', inactive: 'icon_mb_prod_inactive.png' },
  pair: { active: 'icon_mb_pair_active.png', inactive: 'icon_mb_pair_inactive.png' },
  leaf-deep: { active: 'icon_mb_leaf-deep_active.png', inactive: 'icon_mb_leaf-deep_inactive.png' },
  swarm: { active: 'icon_mb_swarm_active.png', inactive: 'icon_mb_swarm_inactive.png' },
  leaf-mid: { active: 'icon_qwen35_active.png', inactive: 'icon_qwen35_off.png' },
  leaf-alt: { active: 'icon_qwen35_35b_active.png', inactive: 'icon_qwen35_35b_off.png' },
}

type Props = {
  doc: import('../../deviceInfo').FleetStateDoc | null
  /** null while mb.switching is live -- MbSlot never renders this page then,
   *  but the prop stays optional-safe regardless. */
  cursor: number | null
  pending: string | null
  /** Arms/fires on the SECOND tap of the same id -- MbSlot owns both the
   *  two-tap arm state and the fire-latch (useFireLatch), so touch and dial
   *  share one confirm/latch pipeline. */
  onTileTap: (actionId: string) => void
  /** Feedback tier 1 (Ruling 13) -- true for one action id, immediately on
   *  fire, independent of the poll. See useFireLatch.ts. */
  isLatched: (actionId: string) => boolean
}

function LeafTile({ id, active, loading, actionId, isCursor, isPending, isLatched, onTileTap }: {
  id: string
  active: boolean
  /** True while ANY seat on the host is loading -- suppresses the flip
   *  control for every tile on this page, not just the active one (a flip
   *  into a loading seat is how you get a half-up leaf). */
  loading: boolean
  actionId: string
  isCursor: boolean
  isPending: boolean
  isLatched: boolean
  onTileTap: (actionId: string) => void
}) {
  const isUncensored = isUncensoredLeaf(id)
  const isReady = isReadyForDuty(id)
  // Re-flipping to the currently-active leaf is a no-op, same rule the old
  // profile tiles used -- and a flip suppressed by a loading seat is inert
  // too (contract field notes: never issue a flip into a loading seat).
  const isInert = active || loading

  // The BORDER carries status only; the cursor is a RING (below). Keeping the
  // two on one property made the cursor invisible on hardware: it sat below
  // `active` in this chain, so resting on the active leaf -- where it starts --
  // hid it completely, and border-stone-400 against border-stone-800 neighbours
  // is nearly indistinguishable at idle backlight (60/255) anyway.
  const borderCls = isPending
    ? 'border-amber-400'
    : isLatched
      ? 'border-sky-400'
      : active
        ? 'border-emerald-400'
        : isUncensored
          ? 'border-red-800'
          : 'border-stone-800'
  const icons = LEAF_ICONS[id] ?? LEAF_ICONS.chat
  const art = active ? icons.active : icons.inactive
  const scrimAlpha = isPending ? 0.4 : active ? 0.45 : loading ? 0.75 : 0.68

  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden border-2 rounded ${borderCls} ${isCursor ? 'ring-2 ring-white' : ''} ${isInert ? 'cursor-default' : 'cursor-pointer'}`}
      onClick={() => {
        if (isInert) return
        onTileTap(actionId)
      }}
    >
      <img src={iconUrl(art)} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
      <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${scrimAlpha})` }} />
      {isReady && (
        <div className="absolute right-1 top-1 rounded bg-stone-900 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-300">
          RFD
        </div>
      )}
      <div className="relative text-sm font-semibold uppercase tracking-widest text-stone-200">{leafDisplayName(id)}</div>
      {isUncensored && (
        <div className="relative mt-0.5 text-[9px] font-bold uppercase tracking-widest text-red-400">UNCENSORED</div>
      )}
      {isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-amber-400">TAP AGAIN</div>}
      {isLatched && !isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-sky-300">SENT</div>}
    </div>
  )
}

/** LEAVES — flip targets, rendered from `commands.flip` (server roster,
 *  NEVER a hardcoded list; empty on lifeline/bench hosts -> "monitoring
 *  only"). Dailies first, then everything else grouped and marked
 *  READY-FOR-DUTY, leaf-alt additionally toned as uncensored (Ruling 7, still a
 *  device-side theme convention, see shared.ts). */
export function LeavesPage({ doc, cursor, pending, onTileTap, isLatched }: Props) {
  const host: FleetHost | null = primaryHost(doc ?? null)
  const leaves = orderedFlipTargets(host)
  const loading = hostLoading(host)

  if (leaves.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-lg font-semibold uppercase tracking-widest text-stone-600">MONITORING ONLY</div>
        <div className="mt-1 text-xs text-stone-700">this host offers no flip targets</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {loading && (
        <div className="shrink-0 pb-1 text-center text-[10px] uppercase tracking-widest text-amber-400">
          FLIPPING — controls suppressed
        </div>
      )}
      <div
        className="flex-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 8 }}
      >
        {leaves.map((id, i) => {
          const actionId = `mb.profile.${id}`
          return (
            <LeafTile
              key={id}
              id={id}
              active={id === host?.leaf?.name}
              loading={loading}
              actionId={actionId}
              isCursor={cursor === i}
              isPending={pending === actionId}
              isLatched={isLatched(actionId)}
              onTileTap={onTileTap}
            />
          )
        })}
      </div>
    </div>
  )
}
