import type { LeafState, MbState } from '../../deviceInfo'
import { FILL_STYLE, iconUrl, leafDisplayName, orderedLeaves } from './shared'

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
  mb: MbState
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

function LeafTile({ leaf, actionId, isCursor, isPending, isLatched, onTileTap }: {
  leaf: LeafState
  actionId: string
  isCursor: boolean
  isPending: boolean
  isLatched: boolean
  onTileTap: (actionId: string) => void
}) {
  const isUncensored = leaf.flags.includes('uncensored')
  const isReady = leaf.tier === 'ready-for-duty'
  // Re-flipping to the currently-active leaf is a no-op, same rule the old
  // profile tiles used -- so active leaves go inert.
  const isInert = leaf.active

  const borderCls = isPending
    ? 'border-amber-400'
    : isLatched
      ? 'border-sky-400'
      : leaf.active
        ? 'border-emerald-400'
        : isCursor
          ? 'border-stone-400'
          : isUncensored
            ? 'border-red-800'
            : 'border-stone-800'
  const icons = LEAF_ICONS[leaf.id] ?? LEAF_ICONS.chat
  const art = leaf.active ? icons.active : icons.inactive
  const scrimAlpha = isPending ? 0.4 : leaf.active ? 0.45 : 0.68

  return (
    <div
      className={`relative flex flex-col items-center justify-center overflow-hidden border-2 rounded ${borderCls} ${isInert ? 'cursor-default' : 'cursor-pointer'}`}
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
      <div className="relative text-sm font-semibold uppercase tracking-widest text-stone-200">{leafDisplayName(leaf.id)}</div>
      {isUncensored && (
        <div className="relative mt-0.5 text-[9px] font-bold uppercase tracking-widest text-red-400">UNCENSORED</div>
      )}
      {isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-amber-400">TAP AGAIN</div>}
      {isLatched && !isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-sky-300">SENT</div>}
    </div>
  )
}

/** LEAVES — flip targets, rendered from mb.leaves (server roster, never
 *  hardcoded). Dailies first, then leaf-mid/leaf-alt grouped and marked READY-FOR-DUTY,
 *  leaf-alt additionally toned as uncensored (Ruling 7). */
export function LeavesPage({ mb, cursor, pending, onTileTap, isLatched }: Props) {
  const leaves = orderedLeaves(mb)
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 8 }}
      >
        {leaves.map((leaf, i) => {
          const actionId = `mb.profile.${leaf.id}`
          return (
            <LeafTile
              key={leaf.id}
              leaf={leaf}
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
