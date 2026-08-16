import { useState } from 'react'

// COMPOSE renders as a disabled placeholder in Phase C (Ruling 12: the
// primary-host-side launcher it needs is a separate, blocked artifact) --
// it still cycles into the page order so M reaches it and the "blocked"
// state is visible, never a page that's silently missing.
export type FleetPage = 'seats' | 'leaves' | 'aux' | 'thermals' | 'compose'
export const FLEET_PAGES: FleetPage[] = ['seats', 'leaves', 'aux', 'thermals', 'compose']

type Params = {
  /** Number of navigable (confirmable) items on the given page. Called at
   *  nav time, not cached — so a changing roster (mb.leaves) is always read
   *  fresh without an effect keyed on it. */
  itemCount: (page: FleetPage) => number
  /** True while mb.switching is non-null — poll-produced state. Read only
   *  inside the handlers below, never as an effect dependency: that pattern
   *  (keying an effect on poll-produced state) is React #185, which has
   *  already blank-screened this device once (see App.tsx). This hook owns
   *  no effects at all, so the trap doesn't apply here regardless. */
  switching: boolean
}

/**
 * Cursor index + page index for the fleet slot's three pages. Input-agnostic:
 * it exposes `onNav`/`onPage` for a caller to wire to whatever produced a nav
 * intent (the hardware dial via useHardwareKeys today) — it adds no window
 * listener of its own and knows nothing about keyboards or touch.
 *
 * Wraps at both ends. Cursor resets to 0 on every page change. While
 * `switching` is true, nav is inert (onNav/onPage no-op) and the returned
 * cursor reads as `null` so a caller can't accidentally render or confirm
 * against a stale position mid-flip.
 */
export function useFleetNav({ itemCount, switching }: Params) {
  const [page, setPage] = useState<FleetPage>('seats')
  const [cursor, setCursor] = useState(0)

  const onPage = () => {
    if (switching) return
    setPage((p) => FLEET_PAGES[(FLEET_PAGES.indexOf(p) + 1) % FLEET_PAGES.length])
    setCursor(0)
  }

  /** Direct page selection (touch page control) -- same reset as onPage's
   *  cycle, just without the cycle math. Both onPage and goToPage are the
   *  only two writers of `page`, so KeyM cycling and touch selection can
   *  never diverge. */
  const goToPage = (target: FleetPage) => {
    if (switching) return
    setPage(target)
    setCursor(0)
  }

  const onNav = (dir: 'up' | 'down') => {
    if (switching) return
    setCursor((c) => {
      const count = itemCount(page)
      if (count <= 0) return 0
      const delta = dir === 'down' ? 1 : -1
      return (c + delta + count) % count
    })
  }

  return { page, cursor: switching ? null : cursor, onNav, onPage, goToPage }
}
