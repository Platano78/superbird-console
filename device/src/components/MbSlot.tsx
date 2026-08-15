import type { MutableRefObject } from 'react'
import { GaugeArc } from './GaugeArc'
import type { DeviceInfoState } from '../deviceInfo'
import { useConfirmArm } from './fleet/useConfirmArm'
import { useFireLatch } from './fleet/useFireLatch'
import { useFailureBanner } from './fleet/useFailureBanner'
import { itemCountFor, primaryHost, resolveConfirmAction } from './fleet/shared'
import { useFleetNav } from '../useFleetNav'
import { SeatsPage } from './fleet/SeatsPage'
import { LeavesPage } from './fleet/LeavesPage'
import { AuxPage } from './fleet/AuxPage'
import { ThermalsPage } from './fleet/ThermalsPage'
import { ComposePage } from './fleet/ComposePage'
import { FailureBanner } from './fleet/FailureBanner'
import { PageTabs } from './fleet/PageTabs'

/** Imperative handoff to App.tsx's single useHardwareKeys call -- MbSlot owns
 *  page/cursor/confirm state (it needs it for rendering anyway), and writes
 *  fresh handlers into this ref on every render while mounted. App.tsx only
 *  invokes them while slot 3 is the active slot -- see App.tsx's onNav/
 *  onPage/onConfirm wrappers. */
export type FleetNavHandlers = { onNav: (dir: 'up' | 'down') => void; onPage: () => void; onConfirm: () => void }

type Props = { info: DeviceInfoState | null; reachable: boolean; navHandlersRef: MutableRefObject<FleetNavHandlers | null> }

/** Slot 3 -- the fleet view shell. Owns paging (SEATS default / LEAVES /
 *  AUX) and renders the active page; the switching/unreachable branches and
 *  the confirm-arming + lastResult error line are the surviving parts of the
 *  old single-grid MbSlot. */
export function MbSlot({ info, reachable, navHandlersRef }: Props) {
  const mb = info?.mb ?? null
  const doc = info?.fleet_state ?? null
  const host = primaryHost(doc)
  const switching = !!mb?.switching

  const { pending, tap } = useConfirmArm()
  // Feedback tier 1 (Ruling 13): instant visual latch on fire, independent
  // of the poll -- see useFireLatch.ts.
  const { fire, isLatched } = useFireLatch(mb)
  // Feedback tier 3, on-screen half (Ruling 13): persistent, explicitly
  // dismissible failure banner -- local-only dismiss, never touches the
  // server's lastResult. See useFailureBanner.ts.
  const { visible: bannerVisible, dismiss: dismissBanner } = useFailureBanner(mb?.lastResult ?? null)

  // The banner claims one extra cursor slot past a page's own items (its
  // OWN highlight + dial-confirm dismiss, per the "cursor/confirm path"
  // requirement) -- itemCount here and the pageBaseCount computed in
  // onConfirm below must agree on that slot's index, so both call the same
  // itemCountFor(page, host).
  const nav = useFleetNav({
    itemCount: (page) => itemCountFor(page, host) + (bannerVisible ? 1 : 0),
    switching,
  })

  const onTileTap = (actionId: string) => {
    if (tap(actionId)) fire(actionId)
  }

  // Written every render while mounted -- App.tsx only ever calls through
  // this while activeSlot===3, so staleness after unmount is harmless.
  navHandlersRef.current = {
    onNav: nav.onNav,
    onPage: nav.onPage,
    onConfirm: () => {
      if (switching || !mb) return
      const cursor = nav.cursor ?? 0
      const pageBaseCount = itemCountFor(nav.page, host)
      if (bannerVisible && cursor === pageBaseCount) {
        dismissBanner()
        return
      }
      const actionId = resolveConfirmAction(nav.page, cursor, host, mb.pcreate.up)
      if (!actionId) return
      onTileTap(actionId)
    },
  }

  if (!reachable || !info || !mb) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">FLEET-HOST</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }

  // Switching view — replaces the whole shell. MUST be checked BEFORE the
  // fleet-state-unreachable branch: mid-flip both fleet-host ports are down
  // by design (profile.sh stop_all), so the aggregator reporting the host as
  // down is the EXPECTED state of a switch in progress — showing
  // "unreachable" then would report a deliberate action as an outage
  // (observed on hardware, first live flip 2026-08-13).
  if (mb.switching) {
    const { target, phase, elapsedMs, budgetMs } = mb.switching
    // commands.est_seconds replaces our invented budgetMs as the progress
    // denominator where the contract offers one (task item 2); budgetMs (the
    // controller's own estimate) is still the fallback when a host doc isn't
    // available yet (e.g. mid-flip, both ports down => aggregator may not
    // have refreshed this host's commands block).
    const es = host?.commands.est_seconds
    const denomS = target === 'herald' ? (es?.summon_herald_cold ?? es?.summon_herald_warm) : (es?.flip ?? es?.flip_warm)
    const denomMs = denomS ? denomS * 1000 : budgetMs
    const pct = denomMs ? Math.min(1, elapsedMs / denomMs) : null
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={pct} tone="amber" size={140} />
        <div className="-mt-1 text-xl font-semibold text-amber-400">SWITCHING → {target === 'leaf-deep' ? 'LEAF-DEEP' : target.toUpperCase()}</div>
        <div className="mt-2 text-sm text-amber-400">{phase} · {Math.round(elapsedMs / 1000)}s</div>
      </div>
    )
  }

  // fleet-state/1 unreachable -- the aggregator errored or hasn't answered
  // yet. Distinct from a reachable document reporting host.reachable=false
  // (that's a real fleet outage, rendered per-tile below, never here).
  if (!doc || !host) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">FLEET-HOST</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">
          {info.fleet_state_error ?? 'fleet state unavailable'}
        </div>
      </div>
    )
  }

  // The banner's own cursor slot sits one past the active page's own items
  // -- see the itemCount/onConfirm comments above for why both must agree.
  const pageBaseCount = itemCountFor(nav.page, host)
  const bannerIsCursor = bannerVisible && nav.cursor === pageBaseCount

  return (
    <div className="flex h-full flex-col" style={{ padding: '8px 12px' }}>
      <PageTabs page={nav.page} goToPage={nav.goToPage} />
      <div className="min-h-0 flex-1">
        {nav.page === 'seats' && (
          <SeatsPage doc={doc} cursor={nav.cursor} pending={pending} onTileTap={onTileTap} isLatched={isLatched} />
        )}
        {nav.page === 'leaves' && (
          <LeavesPage doc={doc} cursor={nav.cursor} pending={pending} onTileTap={onTileTap} isLatched={isLatched} />
        )}
        {nav.page === 'aux' && (
          <AuxPage doc={doc} pcreate={mb.pcreate} cursor={nav.cursor} pending={pending} onTileTap={onTileTap} isLatched={isLatched} />
        )}
        {nav.page === 'thermals' && <ThermalsPage doc={doc} />}
        {nav.page === 'compose' && <ComposePage />}
      </div>

      {/* Feedback tier 3, on-screen half (Ruling 13): persistent until
          explicitly dismissed -- survives a page change, never auto-clears. */}
      {bannerVisible && mb.lastResult && (
        <FailureBanner
          id={mb.lastResult.id}
          error={mb.lastResult.error}
          isCursor={bannerIsCursor}
          onDismiss={dismissBanner}
        />
      )}
    </div>
  )
}
