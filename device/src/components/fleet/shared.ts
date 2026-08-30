import type { CSSProperties } from 'react'
import type { FleetHost, FleetStateDoc } from '../../deviceInfo'
import { requestFastPoll } from '../../deviceInfo'
import { inertAction } from '../../demo/inert'
import type { FleetPage } from '../../useFleetNav'
import { DAILY_LEAVES, LEAF_DISPLAY_NAMES, UNCENSORED_LEAVES } from './leafTheme'

/** The primary surface is chosen by ROLE, never by a hardcoded host id.
 *
 *  The contract permits consumers to hardcode the primary's `id`, and this
 *  once did. That baked one particular deployment's host name into shipped
 *  source, which is both a portability bug (anyone else's fleet names its
 *  hosts differently) and a privacy one. `role` is carried by every host in
 *  the document, exactly one is `primary`, and it means precisely what this
 *  function is asking. Falling back to the first host keeps a single-host
 *  document working even if a producer ever omits the field. */
export function primaryHost(doc: FleetStateDoc | null): FleetHost | null {
  if (!doc) return null
  return doc.hosts.find((h) => h.role === 'primary') ?? doc.hosts[0] ?? null
}

/** Title for the two branches that have NO host document to take a label
 *  from (service unreachable / aggregator down). With no document there is
 *  no host name to print and guessing one would be a lie, so this names the
 *  SUBJECT rather than any particular machine. */
export function primaryHostTitle(): string {
  return 'FLEET'
}

/** Every host that isn't the primary surface -- rendered monitoring-only
 *  (task item 4: "do not build a host switcher unless it falls out
 *  naturally"). Order preserved from the document. */
export function secondaryHosts(doc: FleetStateDoc | null): FleetHost[] {
  if (!doc) return []
  const primary = primaryHost(doc)
  return doc.hosts.filter((h) => h !== primary)
}

// Icons are PLAIN RUNTIME STRINGS, not ES-module asset imports — see
// MbSlot.tsx / ControlSlot.tsx for why an asset-URL import blank-screens
// this Chromium 69 kiosk.
export function iconUrl(file: string) {
  return `./icons/${file}`
}

// Explicit top/right/bottom/left, not `inset` shorthand.
export const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }

/** Device greys a probe as stale past ~15s of its OWN `age_s` (law 5: trust
 *  the per-probe age, never the document's generated_at). Grey the
 *  individual tile that went stale, never the whole page. */
export const STALE_S = 15

const ACTION_URL = 'http://127.0.0.1:8791/action'

/** Fire an action: fast-poll then POST — fire-and-forget, same shape as
 *  MbSlot.tsx's own fireAction (each slot component keeps its own copy —
 *  the established pattern here, see ControlSlot.tsx's own iconUrl). */
export function fireAction(id: string, extra?: Record<string, unknown>) {
  // 🔴 DEMO GUARD (ruling 4): in demo mode NOTHING is posted -- the tap
  // returns here, having published a visible "action not sent" notice.
  if (inertAction(id)) return
  requestFastPoll()
  void runTwoStep(id, extra)
}

/**
 * 🔴 The mb.* two-step is the SERVER's contract, and the client must complete
 * it. POST #1 returns a single-use `confirm_token` and deliberately executes
 * NOTHING; POST #2 carries the token back and is what actually runs.
 *
 * This was a live defect from 2026-08-15 (`37171fe`, which added the token
 * server-side) until 2026-08-16: the device only ever sent POST #1, so every
 * leaf flip, herald summon and pcreate toggle fired from the fleet view was a
 * silent no-op. Nothing caught it because each layer was individually correct
 * -- the server safely declined to act without a token, the device latched its
 * tile to "committed" the instant it posted, and `mb.switching` stayed null so
 * the latch never cleared. A button that looks like it worked and does nothing
 * is the exact failure this codebase keeps refusing.
 *
 * Non-mb ids (the buttons.json CONTROL grid) execute on POST #1 and return no
 * token -- for those there is nothing to confirm and we stop after one.
 */
async function runTwoStep(id: string, extra?: Record<string, unknown>) {
  const post = (body: Record<string, unknown>) =>
    fetch(ACTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  try {
    const first = await post({ id, ...extra })
    const out = await first.json().catch(() => null)
    const token = out && typeof out.confirm_token === 'string' ? out.confirm_token : null
    if (!token) return
    await post({ id, ...extra, confirm_token: token })
    requestFastPoll()
  } catch {
    // Transport failure surfaces through /state (the action never lands and
    // no `lastResult` appears) rather than a thrown promise nobody awaits.
  }
}

/** Display names are THEME, wire ids are CONTRACT — a leaf may render under
 *  another name but stays its own id in every action POST. The mapping lives
 *  in leafTheme.ts; every caller must come through HERE rather than inlining
 *  its own copy. */
export function leafDisplayName(id: string): string {
  return LEAF_DISPLAY_NAMES[id] ?? id.toUpperCase()
}

// Grouping/tone below (daily vs "ready for duty", uncensored) is DEVICE-SIDE
// theme -- NOT part of the contract (fleet-state/1 carries no tier field). The
// roster itself always comes from `commands.flip`, never this list: an
// unrecognised leaf name still renders, just falls into the "ready for duty"
// bucket by default instead of crashing or being dropped.
export function isReadyForDuty(id: string): boolean {
  // An empty DAILY_LEAVES means the fleet draws no daily/rest distinction, so
  // nothing is badged. Without this guard the negation inverts and EVERY tile
  // would claim to be ready for duty -- loudest possible output from the
  // emptiest possible config.
  if (DAILY_LEAVES.length === 0) return false
  return !DAILY_LEAVES.includes(id)
}
export function isUncensoredLeaf(id: string): boolean {
  return UNCENSORED_LEAVES.includes(id)
}

/** `commands.flip` ordered dailies-first, then everything else in the order
 *  the contract gave it — the roster itself is never hardcoded, only this
 *  display grouping is. Every caller (LeavesPage's render order,
 *  itemCountFor, resolveConfirmAction) must use this same function so the
 *  cursor index and the rendered order never diverge. */
export function orderedFlipTargets(host: FleetHost | null): string[] {
  if (!host) return []
  const flip = host.commands.flip
  const dailies = DAILY_LEAVES.filter((id) => flip.includes(id))
  const rest = flip.filter((id) => !DAILY_LEAVES.includes(id))
  return [...dailies, ...rest]
}

/** True while ANY seat on the host is `loading` — a flip issued into a
 *  loading seat is how you get a half-up leaf (contract field notes).
 *  LEAVES must suppress its flip controls for the whole host while this
 *  holds, not just the one seat that's loading. */
export function hostLoading(host: FleetHost | null): boolean {
  if (!host) return false
  return host.seats.some((s) => s.state === 'loading')
}

/** True when this host's senior seat can take a herald summon/dismiss verb
 *  at all (`commands.summon` carries "herald"). Hosts with no summon verb
 *  (secondary hosts) render seats read-only. */
export function heraldCapable(host: FleetHost | null): boolean {
  return !!host?.commands.summon.includes('herald')
}

/** True when the senior seat is currently held by a herald-class occupant --
 *  drives DISMISS vs SUMMON. Read straight off the seat's own `herald` flag,
 *  never inferred from occupant.short (never parsed, contract law). */
export function heraldActive(host: FleetHost | null): boolean {
  return !!host?.seats.find((s) => s.id === 'senior')?.herald
}

/** `occupant.short` is best-effort and, on the live producer today, a raw
 *  33+ char GGUF basename -- see the fleet-state contract §2.1 (we
 *  asked the fleet-state aggregator for a hard-capped `short_display` field; this truncation is
 *  the stopgap until it lands).
 *
 *  ⚠ Takes the BASENAME before clipping. The fallback path (fleet_state down)
 *  passes a raw `/v1/models` path, and clipping that from the left produced
 *  "/MODELS/GE…" and "/MODELS/GP…" on hardware -- every model rendering as its
 *  identical directory prefix, so a 26B and a 120B were indistinguishable on
 *  the one screen whose entire job is telling you who is in the seats.
 *  Basename-then-clip is purely mechanical (no substring is mapped to a
 *  name), and it is a no-op for the contract path, which already supplies a
 *  bare basename with no slashes. */
export function truncateOccupant(short: string | null | undefined, max = 11): string {
  if (!short) return '--'
  const base = (short.split('/').pop() || short).replace(/\.gguf$/i, '')
  return base.length > max ? `${base.slice(0, max - 1)}…` : base
}

/** Number of cursor-navigable (confirmable) items per page. SEATS carries at
 *  most one verb -- herald summon/dismiss, attached to the senior seat, only
 *  when the host's `commands.summon` offers it. LEAVES walks
 *  `commands.flip` (empty on lifeline/bench hosts -> zero, monitoring-only).
 *  AUX carries pcreate's single toggle verb -- controller-owned live on/off
 *  state (`mb.pcreate.up`), NOT part of fleet-state/1 (see MbPcreate in
 *  deviceInfo.ts / the fleet-state contract §2.2, §3). `host` alone
 *  gates the page (aux is independent of which host is primary today), but
 *  the count itself doesn't need `mb` -- it's always exactly one tile. */
export function itemCountFor(page: FleetPage, host: FleetHost | null): number {
  if (!host) return 0
  if (page === 'seats') return heraldCapable(host) ? 1 : 0
  if (page === 'leaves') return hostLoading(host) ? 0 : orderedFlipTargets(host).length
  if (page === 'aux') return 1 // pcreate's single start/stop toggle
  return 0 // thermals: monitor-only. compose: disabled placeholder.
}

/** What the dial's confirm (Enter, no ask pending) fires for the current
 *  page+cursor — the SAME action id the on-screen tiles POST, so dial and
 *  touch share one two-tap confirm state (see MbSlot's useConfirmArm).
 *  `pcreateUp` is `mb.pcreate.up` -- controller-owned, not part of
 *  fleet-state/1 (see itemCountFor's doc) -- it's the only page whose
 *  action id depends on state outside `host`. */
export function resolveConfirmAction(page: FleetPage, cursor: number, host: FleetHost | null, pcreateUp: boolean): string | null {
  if (!host) return null
  if (page === 'seats') {
    if (cursor !== 0 || !heraldCapable(host)) return null
    // Unlike a leaf tile, this stays actionable WHILE ACTIVE -- active
    // (herald summoned) is precisely the state DISMISS must fire from.
    return heraldActive(host) ? 'mb.herald.dismiss' : 'mb.herald.summon'
  }
  if (page === 'leaves') {
    if (hostLoading(host)) return null // suppressed while a seat is mid-flip
    const leaf = orderedFlipTargets(host)[cursor]
    if (!leaf || leaf === host.leaf?.name) return null // re-flipping the active leaf is a no-op
    return `mb.profile.${leaf}`
  }
  if (page === 'aux') {
    if (cursor !== 0) return null
    // Same rule as the herald tile: stays actionable WHILE ACTIVE -- active
    // (pcreate up) is precisely the state STOP must fire from.
    return pcreateUp ? 'mb.pcreate.stop' : 'mb.pcreate.start'
  }
  return null
}
