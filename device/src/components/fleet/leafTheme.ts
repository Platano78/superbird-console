/** THE ONE PLACE a local fleet's identity lives.
 *
 *  Everything here is THEME. Wire ids are CONTRACT: a leaf is named by
 *  `commands.flip` from fleet-state/1 and goes back verbatim in every action
 *  POST, so nothing in this file may change what is sent — only what is drawn.
 *
 *  It exists as a separate module because leaf identity used to be scattered:
 *  an icon map in LeavesPage, a rename in shared.ts, a SECOND copy of that
 *  same rename inlined in MbSlot's switching view, and a daily-vs-rest list.
 *  On 2026-08-30 a leaf's art moved and the labels did not follow, so the tile
 *  reading "LEAF-DEEP" showed one character while the tile beside it showed
 *  that character and read something else. Four copies of one identity, and
 *  fixing three of them still shipped the bug. One file, one copy.
 *
 *  ALL FOUR MAY BE EMPTY. Empty is the honest default for a fleet that is not
 *  this one: no art, ids render as their own uppercase name, nothing is
 *  badged. Add your own entries — the keys are whatever leaf names your
 *  `commands.flip` actually carries.
 */

/** Tile art, keyed by leaf id. Files live in `device/public/icons/`.
 *  A leaf with NO entry renders art-less rather than borrowing another
 *  leaf's — see LeavesPage. Do not add a fallback to some other leaf's icon:
 *  an unfamiliar dark tile reads as "no art yet", a familiar one reads as the
 *  wrong leaf, and only one of those is honest. */
export const LEAF_ICONS: Record<string, { active: string; inactive: string }> = {
  chat: { active: 'icon_mb_chat_active.png', inactive: 'icon_mb_chat_inactive.png' },
  prod: { active: 'icon_mb_prod_active.png', inactive: 'icon_mb_prod_inactive.png' },
  pair: { active: 'icon_mb_pair_active.png', inactive: 'icon_mb_pair_inactive.png' },
  leaf-deep: { active: 'icon_mb_leaf-deep_active.png', inactive: 'icon_mb_leaf-deep_inactive.png' },
  leaf-solo: { active: 'icon_mb_leaf-solo_active.png', inactive: 'icon_mb_leaf-solo_inactive.png' },
  swarm: { active: 'icon_mb_swarm_active.png', inactive: 'icon_mb_swarm_inactive.png' },
  leaf-mid: { active: 'icon_mb_leaf-mid_active.png', inactive: 'icon_mb_leaf-mid_inactive.png' },
  leaf-alt: { active: 'icon_mb_leaf-alt_active.png', inactive: 'icon_mb_leaf-alt_inactive.png' },
}

/** Leaf id -> the name drawn on the tile. Anything absent renders as its own
 *  id, uppercased. Keep this in step with LEAF_ICONS: a rename that does not
 *  follow its art is the exact defect this module was created to prevent. */
export const LEAF_DISPLAY_NAMES: Record<string, string> = {
  leaf-deep: 'LEAF-DEEP',
}

/** Leaves in the everyday rotation. They sort first and carry no badge;
 *  everything else is badged READY-FOR-DUTY. An EMPTY list means "no such
 *  distinction here" and nothing is badged — not "everything is RFD". */
export const DAILY_LEAVES: string[] = ['chat', 'prod', 'swarm', 'pair', 'leaf-deep']

/** Leaves drawn in the warning tone with an UNCENSORED label. */
export const UNCENSORED_LEAVES: string[] = ['leaf-alt']
