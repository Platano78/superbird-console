import type { MbState, SeatState } from '../../deviceInfo'
import { STALE_MS, leafDisplayName } from './shared'

/** Worker before senior, always -- deterministic layout regardless of the
 *  server's array order. */
function orderedSeats(seats: SeatState[]): SeatState[] {
  return [...seats].sort((a) => (a.seat === 'worker' ? -1 : 1))
}

function WorkerSeatTile({ seat, serverNowMs }: { seat: SeatState; serverNowMs: number }) {
  // Age is rendered, not just carried -- dim past ~15s rather than blank,
  // so the last-known occupant stays visible (the fleet-state contract §4).
  const stale = seat.probedAtMs === null || serverNowMs - seat.probedAtMs > STALE_MS
  const borderCls = !seat.up ? 'border-red-500' : stale ? 'border-stone-700' : 'border-emerald-400'
  const occupantCls = !seat.up ? 'text-stone-500' : stale ? 'text-stone-500' : 'text-stone-50'

  return (
    <div className={`relative flex flex-col items-center justify-center border-2 rounded ${borderCls}`}>
      <div className="text-xs uppercase tracking-widest text-stone-500">
        {seat.seat.toUpperCase()} · {seat.port}
      </div>
      <div className={`mt-1 text-xl font-bold uppercase tracking-widest ${occupantCls}`}>
        {seat.occupantShort ?? (seat.up ? '--' : 'DOWN')}
      </div>
      {!seat.up && seat.error && (
        <div className="mt-1 max-w-full truncate px-2 text-[10px] text-red-400">{seat.error}</div>
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
  serverNowMs,
  herald,
  isCursor,
  isPending,
  isLatched,
  onTileTap,
}: {
  seat: SeatState
  serverNowMs: number
  herald: boolean
  isCursor: boolean
  isPending: boolean
  isLatched: boolean
  onTileTap: (actionId: string) => void
}) {
  const stale = seat.probedAtMs === null || serverNowMs - seat.probedAtMs > STALE_MS
  const actionId = herald ? 'mb.herald.dismiss' : 'mb.herald.summon'
  const borderCls = isPending
    ? 'border-amber-400'
    : isLatched
      ? 'border-sky-400'
      : herald
        ? 'border-emerald-400'
        : isCursor
          ? 'border-stone-400'
          : !seat.up
            ? 'border-red-500'
            : stale
              ? 'border-stone-700'
              : 'border-stone-800'
  const occupantCls = !seat.up ? 'text-stone-500' : stale ? 'text-stone-500' : 'text-stone-50'

  return (
    <div
      className={`relative flex cursor-pointer flex-col items-center justify-center border-2 rounded ${borderCls}`}
      onClick={() => onTileTap(actionId)}
    >
      <div className="text-xs uppercase tracking-widest text-stone-500">
        {seat.seat.toUpperCase()} · {seat.port}
      </div>
      <div className={`mt-1 text-xl font-bold uppercase tracking-widest ${occupantCls}`}>
        {seat.occupantShort ?? (seat.up ? '--' : 'DOWN')}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-widest text-stone-400">SILVER SURFER</div>
      <div className="text-sm font-semibold uppercase tracking-widest text-stone-200">
        {isPending ? 'TAP AGAIN' : isLatched ? 'SENT' : herald ? 'DISMISS' : 'SUMMON'}
      </div>
    </div>
  )
}

type Props = {
  mb: MbState
  serverNowMs: number
  /** null while mb.switching is live -- MbSlot never renders this page then. */
  cursor: number | null
  pending: string | null
  /** See LeavesPage.tsx's Props doc -- same shared confirm/latch pipeline. */
  onTileTap: (actionId: string) => void
  isLatched: (actionId: string) => boolean
}

/** SEATS — the default/rest page. Worker and senior seats as the two
 *  persistent objects, per the ratified seat model. Worker is monitoring
 *  only; senior carries the herald summon/dismiss verb (see SeniorSeatTile). */
export function SeatsPage({ mb, serverNowMs, cursor, pending, onTileTap, isLatched }: Props) {
  const activeLeaf = mb.leaves.find((l) => l.active)
  const heraldActionId = mb.herald ? 'mb.herald.dismiss' : 'mb.herald.summon'

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between">
        <div className="text-3xl font-bold uppercase tracking-widest text-stone-50">
          {activeLeaf ? leafDisplayName(activeLeaf.id) : '--'}
        </div>
      </div>

      <div className="flex-1" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        {orderedSeats(mb.seats).map((seat) =>
          seat.seat === 'senior' ? (
            <SeniorSeatTile
              key={seat.seat}
              seat={seat}
              serverNowMs={serverNowMs}
              herald={mb.herald}
              isCursor={cursor === 0}
              isPending={pending === heraldActionId}
              isLatched={isLatched(heraldActionId)}
              onTileTap={onTileTap}
            />
          ) : (
            <WorkerSeatTile key={seat.seat} seat={seat} serverNowMs={serverNowMs} />
          ),
        )}
      </div>
    </div>
  )
}
