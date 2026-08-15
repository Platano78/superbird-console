import type { FleetHost, FleetSeat, FleetStateDoc } from '../../deviceInfo'
import { STALE_S, heraldActive, heraldCapable, leafDisplayName, secondaryHosts, truncateOccupant } from './shared'

/** Known seats first (worker, senior) in that order, then anything else the
 *  contract adds (e.g. worker2) in document order — additive evolution
 *  (law 7): an unrecognised seat id still renders, it just falls after the
 *  known pair instead of crashing or being dropped. */
const KNOWN_ORDER = ['worker', 'senior']
function orderedSeats(seats: FleetSeat[]): FleetSeat[] {
  return [...seats].sort((a, b) => {
    const ia = KNOWN_ORDER.indexOf(a.id)
    const ib = KNOWN_ORDER.indexOf(b.id)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/**
 * The 4-way `state` switch every seat tile renders from (task's core
 * requirement, replacing the old `up` boolean collapse):
 *  - serving      -> occupant, normal tone
 *  - loading      -> progress affordance, amber -- and the LEAVES page
 *                    separately suppresses flip controls while this holds
 *  - empty        -> "SEAT EMPTY", NEUTRAL tone -- a normal, often intended
 *                    condition (leaf-deep empties the worker BY DESIGN), never
 *                    styled as a fault
 *  - unreachable  -> grey, keep the last-known occupant CLEARLY marked stale
 *  - unknown/else -> "--"
 */
function seatBodyText(seat: FleetSeat): string {
  switch (seat.state) {
    case 'serving':
      return truncateOccupant(seat.occupant?.short)
    case 'loading':
      return 'LOADING'
    case 'empty':
      return 'SEAT EMPTY'
    case 'unreachable':
      return seat.occupant?.short ? truncateOccupant(seat.occupant.short) : '--'
    case 'unknown':
    default:
      return '--'
  }
}

function seatTone(seat: FleetSeat): { border: string; body: string; label: string } {
  const stale = seat.age_s > STALE_S
  switch (seat.state) {
    case 'serving':
      return stale
        ? { border: 'border-stone-700', body: 'text-stone-500', label: 'text-stone-600' }
        : { border: 'border-emerald-400', body: 'text-stone-50', label: 'text-stone-500' }
    case 'loading':
      return { border: 'border-amber-400', body: 'text-amber-300', label: 'text-stone-500' }
    case 'empty':
      // Deliberately NOT red/amber -- an empty seat is often intended
      // (leaf-deep empties the worker by design). Neutral, not alarming.
      return { border: 'border-stone-700', body: 'text-stone-500', label: 'text-stone-600' }
    case 'unreachable':
      return { border: 'border-stone-800', body: 'text-stone-600', label: 'text-stone-700' }
    case 'unknown':
    default:
      return { border: 'border-stone-800', body: 'text-stone-600', label: 'text-stone-700' }
  }
}

function WorkerSeatTile({ seat }: { seat: FleetSeat }) {
  const tone = seatTone(seat)
  const stale = seat.state === 'unreachable' && seat.age_s > STALE_S
  return (
    <div className={`relative flex flex-col items-center justify-center border-2 rounded ${tone.border}`}>
      <div className={`text-xs uppercase tracking-widest ${tone.label}`}>
        {seat.label.toUpperCase()} · {seat.port}
      </div>
      <div className={`mt-1 text-xl font-bold uppercase tracking-widest ${tone.body}`}>{seatBodyText(seat)}</div>
      {seat.state === 'unreachable' && stale && (
        <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-red-400">STALE</div>
      )}
    </div>
  )
}

/**
 * Senior seat -- carries the herald verb (owner ruling: herald is a summon
 * ONTO the senior seat, not a leaf flip, so the verb lives on the seat it
 * acts on rather than as a peer tile in LEAVES, which would re-flatten it
 * into "just another leaf" -- the exact confusion this re-present fixes).
 * Unlike a leaf tile, this stays actionable WHILE ACTIVE: mb.herald===true is
 * precisely the state DISMISS must fire from, so it never goes inert.
 * SILVER SURFER is the identity label above the verb (old MbSlot's verb-tile
 * idiom -- owner feedback there: "what is START?", the verb alone isn't
 * identifiable). No client-side "ready" indicator: herald is ~35s warm but
 * 6-7min cold and /health answers 200 long before generation works -- the
 * server's completion gate already covers this.
 */
function SeniorSeatTile({
  seat,
  herald,
  isCursor,
  isPending,
  isLatched,
  onTileTap,
}: {
  seat: FleetSeat
  herald: boolean
  isCursor: boolean
  isPending: boolean
  isLatched: boolean
  onTileTap: (actionId: string) => void
}) {
  const tone = seatTone(seat)
  const actionId = herald ? 'mb.herald.dismiss' : 'mb.herald.summon'
  const borderCls = isPending ? 'border-amber-400' : isLatched ? 'border-sky-400' : isCursor ? 'border-stone-400' : tone.border

  return (
    <div
      className={`relative flex cursor-pointer flex-col items-center justify-center border-2 rounded ${borderCls}`}
      onClick={() => onTileTap(actionId)}
    >
      <div className={`text-xs uppercase tracking-widest ${tone.label}`}>
        {seat.label.toUpperCase()} · {seat.port}
      </div>
      <div className={`mt-1 text-xl font-bold uppercase tracking-widest ${tone.body}`}>{seatBodyText(seat)}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-stone-400">SILVER SURFER</div>
      <div className="text-sm font-semibold uppercase tracking-widest text-stone-200">
        {isPending ? 'TAP AGAIN' : isLatched ? 'SENT' : herald ? 'DISMISS' : 'SUMMON'}
      </div>
    </div>
  )
}

/** Compact monitoring-only chip for a non-primary host (secondary-host,
 *  router-5080) -- `commands.flip: []` there means no flip control, ever
 *  (task item 4: "at minimum the SEATS page must not assume a single
 *  host"). No cursor/confirm reaches these -- itemCountFor never counts them. */
function SecondaryHostChip({ host }: { host: FleetHost }) {
  const seat = host.seats[0]
  const tone = seat ? seatTone(seat) : { border: 'border-stone-800', body: 'text-stone-600', label: 'text-stone-700' }
  return (
    <div className={`flex flex-col items-center justify-center border rounded px-2 py-1 ${host.reachable ? tone.border : 'border-stone-800'}`}>
      <div className="text-[9px] uppercase tracking-widest text-stone-500">{host.label}</div>
      <div className={`text-[11px] font-semibold uppercase tracking-widest ${host.reachable ? tone.body : 'text-stone-700'}`}>
        {host.reachable ? (seat ? seatBodyText(seat) : '--') : 'UNREACHABLE'}
      </div>
    </div>
  )
}

type Props = {
  doc: FleetStateDoc | null
  /** null while mb.switching is live -- MbSlot never renders this page then. */
  cursor: number | null
  pending: string | null
  /** See LeavesPage.tsx's Props doc -- same shared confirm/latch pipeline. */
  onTileTap: (actionId: string) => void
  isLatched: (actionId: string) => boolean
}

/** SEATS — the default/rest page. Primary host's seats as the persistent
 *  objects (worker/senior/whatever the contract adds), rendered by `state`,
 *  never the old collapsed `up` boolean. Secondary hosts (secondary-host,
 *  router-5080) render as read-only monitoring chips underneath. */
export function SeatsPage({ doc, cursor, pending, onTileTap, isLatched }: Props) {
  const host = doc?.hosts.find((h) => h.id === 'fleet-host') ?? null
  if (!host) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-xl font-semibold text-stone-500">NO FLEET DATA</div>
      </div>
    )
  }
  const canSummon = heraldCapable(host)
  const herald = heraldActive(host)
  const heraldActionId = herald ? 'mb.herald.dismiss' : 'mb.herald.summon'
  const others = secondaryHosts(doc)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-baseline justify-between">
        <div className="text-3xl font-bold uppercase tracking-widest text-stone-50">
          {leafDisplayName(host.leaf?.name ?? 'unknown')}
        </div>
        {/* leaf.name is INFERRED, never reported (law 2) -- show the basis
            small, next to the headline reading, so an "unknown" leaf still
            carries context instead of just a blank guess. */}
        <div className="max-w-[45%] truncate text-[9px] uppercase tracking-widest text-stone-600">
          {host.leaf?.inferred_from ?? ''}
        </div>
      </div>

      <div className="flex-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        {orderedSeats(host.seats).map((seat) =>
          seat.id === 'senior' && canSummon ? (
            <SeniorSeatTile
              key={seat.id}
              seat={seat}
              herald={herald}
              isCursor={cursor === 0}
              isPending={pending === heraldActionId}
              isLatched={isLatched(heraldActionId)}
              onTileTap={onTileTap}
            />
          ) : (
            <WorkerSeatTile key={seat.id} seat={seat} />
          ),
        )}
      </div>

      {others.length > 0 && (
        <div className="mt-2 flex shrink-0 items-center justify-center" style={{ gap: 8 }}>
          {others.map((h) => (
            <SecondaryHostChip key={h.id} host={h} />
          ))}
        </div>
      )}
    </div>
  )
}
