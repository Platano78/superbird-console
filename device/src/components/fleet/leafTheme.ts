/** THE ONE PLACE a local fleet's identity lives — and it ships EMPTY.
 *
 *  Everything here is THEME. Wire ids are CONTRACT: a leaf is named by
 *  `commands.flip` from fleet-state/1 and goes back verbatim in every action
 *  POST, so nothing in this file may change what is sent — only what is drawn.
 *
 *  Out of the box this console draws whatever leaves your own fleet reports:
 *  each tile shows its id in uppercase, with no art and no badges. That is a
 *  working panel, not a broken one. Fill these in to make it yours.
 *
 *  ── LEAF_ICONS ────────────────────────────────────────────────────────────
 *  Tile art, keyed by leaf id. Drop PNGs into `device/public/icons/` and name
 *  them here. 256x256 works well; the tile draws them cover-fit under a scrim,
 *  so busy edges are fine but keep the subject centred.
 *
 *      export const LEAF_ICONS: Record<string, { active: string; inactive: string }> = {
 *        chat: { active: 'my_chat_active.png', inactive: 'my_chat_inactive.png' },
 *      }
 *
 *  A leaf with NO entry renders art-less. Do NOT add a fallback to some other
 *  leaf's icon: an unfamiliar dark tile reads as "no art yet", a familiar one
 *  reads as the wrong leaf, and only one of those is honest. A missing FILE is
 *  handled too — the <img> hides rather than drawing a broken-image glyph.
 *  Give each pair a visibly dimmer inactive variant; ~0.8 of the active's
 *  brightness and saturation matches how the tiles read at a glance.
 *
 *  ── LEAF_DISPLAY_NAMES ────────────────────────────────────────────────────
 *  Leaf id -> the name drawn on the tile. Anything absent renders as its own
 *  id, uppercased. Keep it in step with LEAF_ICONS: a rename that does not
 *  follow its art puts one character's name on another character's tile.
 *
 *  ── DAILY_LEAVES ──────────────────────────────────────────────────────────
 *  Leaves in your everyday rotation. They sort first and carry no badge;
 *  everything else is badged READY-FOR-DUTY. EMPTY means "no such distinction
 *  here" and nothing is badged — not "everything is RFD".
 *
 *  ── UNCENSORED_LEAVES ─────────────────────────────────────────────────────
 *  Leaves drawn in the warning tone with an UNCENSORED label, if that
 *  distinction means something on your fleet.
 */

export const LEAF_ICONS: Record<string, { active: string; inactive: string }> = {}

export const LEAF_DISPLAY_NAMES: Record<string, string> = {}

export const DAILY_LEAVES: string[] = []

export const UNCENSORED_LEAVES: string[] = []
