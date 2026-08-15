import type { FleetPage } from '../../useFleetNav'
import { FLEET_PAGES } from '../../useFleetNav'

const LABEL: Record<FleetPage, string> = {
  seats: 'SEATS',
  leaves: 'LEAVES',
  aux: 'AUX',
  thermals: 'THERM',
  compose: 'COMPOSE',
}

type Props = {
  page: FleetPage
  /** Nav-only -- never fires an mb.* action, never touches confirm-arm
   *  state (Ruling 6). Wired straight to useFleetNav's goToPage. */
  goToPage: (page: FleetPage) => void
}

/** Always-visible touch page control (Ruling 1/2/4) -- three short labels,
 *  the active one highlighted. Direct selection, not cycle-through: fewer
 *  taps than mirroring KeyM's cycle. Kept to a single row of small text so
 *  it stays well under the ~24px budget. */
export function PageTabs({ page, goToPage }: Props) {
  return (
    // ⚠ Spacing is per-child `marginLeft`, NOT flex `gap` — flex gap is
    // unsupported on this Chromium 69 kiosk (it landed in Chrome 84) and
    // renders as ZERO spacing. Grid gap is the only gap form that works here.
    // This exact violation already shipped once and was fixed on hardware
    // (mb-slot_spec.md amend log: "flex-gap violation fixed (badges → ml-2)").
    <div className="flex shrink-0 items-center justify-center" style={{ marginBottom: 4 }}>
      {FLEET_PAGES.map((p, i) => (
        <div
          key={p}
          className={`cursor-pointer text-[11px] font-semibold uppercase tracking-widest ${
            p === page ? 'text-sky-400' : 'text-stone-600'
          }`}
          style={i > 0 ? { marginLeft: 12 } : undefined}
          onClick={() => goToPage(p)}
        >
          {LABEL[p]}
        </div>
      ))}
    </div>
  )
}
