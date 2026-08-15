import type { CSSProperties } from 'react'
import type { LeafState, MbState } from '../../deviceInfo'
import { requestFastPoll } from '../../deviceInfo'
import type { FleetPage } from '../../useFleetNav'

// Icons are PLAIN RUNTIME STRINGS, not ES-module asset imports — see
// MbSlot.tsx / ControlSlot.tsx for why an asset-URL import blank-screens
// this Chromium 69 kiosk.
export function iconUrl(file: string) {
  return `./icons/${file}`
}

// Explicit top/right/bottom/left, not `inset` shorthand.
export const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }

/** Device shows a source as stale past ~15s (3 poll intervals at the 5s
 *  steady cadence) — the fleet-state contract §4. */
export const STALE_MS = 15000

const ACTION_URL = 'http://127.0.0.1:8791/action'

/** Fire an action: fast-poll then POST — fire-and-forget, same shape as
 *  MbSlot.tsx's own fireAction (each slot component keeps its own copy —
 *  the established pattern here, see ControlSlot.tsx's own iconUrl). */
export function fireAction(id: string) {
  requestFastPoll()
  void fetch(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}

/** Display names are THEME, wire ids are CONTRACT — dsv4f renders GALACTUS
 *  but stays dsv4f in every action POST. */
export function leafDisplayName(id: string): string {
  if (id === 'dsv4f') return 'GALACTUS'
  return id.toUpperCase()
}

/** Dailies first, then ready-for-duty (q38/q38h) grouped — owner ruling
 *  2026-08-15, the fleet-state contract §2. This ordering is also
 *  what the cursor index walks, so every caller (LeavesPage's render order,
 *  itemCountFor, resolveConfirmAction) must use this same function. */
export function orderedLeaves(mb: MbState): LeafState[] {
  const dailies = mb.leaves.filter((l) => l.tier === 'daily')
  const ready = mb.leaves.filter((l) => l.tier === 'ready-for-duty')
  return [...dailies, ...ready]
}

/** Number of cursor-navigable (confirmable) items per page. SEATS carries
 *  exactly one verb -- herald summon/dismiss, attached to the senior seat
 *  (owner ruling: herald is a summon ONTO the senior seat, not a leaf, so
 *  the verb lives on the seat it acts on, not as a peer tile in LEAVES). The
 *  worker seat has no verb of its own. */
export function itemCountFor(page: FleetPage, mb: MbState | null): number {
  if (!mb) return 0
  if (page === 'seats') return 1 // the senior seat's herald summon/dismiss
  if (page === 'leaves') return mb.leaves.length
  if (page === 'aux') return 1 // pcreate is the one navigable/actionable item
  return 0 // compose: disabled placeholder in Phase C, nothing confirmable
}

/** What the dial's confirm (Enter, no ask pending) fires for the current
 *  page+cursor — the SAME action id the on-screen tiles POST, so dial and
 *  touch share one two-tap confirm state (see MbSlot's useConfirmArm). */
export function resolveConfirmAction(page: FleetPage, cursor: number, mb: MbState): string | null {
  if (page === 'seats') {
    if (cursor !== 0) return null
    // Unlike a leaf tile, this stays actionable WHILE ACTIVE -- active
    // (herald summoned) is precisely the state DISMISS must fire from.
    return mb.herald ? 'mb.herald.dismiss' : 'mb.herald.summon'
  }
  if (page === 'leaves') {
    const leaf = orderedLeaves(mb)[cursor]
    if (!leaf || leaf.active) return null // re-flipping to the active leaf is a no-op, same as touch
    return `mb.profile.${leaf.id}`
  }
  if (page === 'aux') {
    if (cursor !== 0) return null
    return mb.pcreate ? 'mb.pcreate.stop' : 'mb.pcreate.start'
  }
  return null
}
