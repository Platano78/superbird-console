import type { MutableRefObject } from 'react'
import { GaugeArc } from './GaugeArc'
import type { DeviceInfoState } from '../deviceInfo'
import { useConfirmArm } from './fleet/useConfirmArm'
import { useFireLatch } from './fleet/useFireLatch'
import { useFailureBanner } from './fleet/useFailureBanner'
import { itemCountFor, resolveConfirmAction } from './fleet/shared'
import { useFleetNav } from '../useFleetNav'
import { SeatsPage } from './fleet/SeatsPage'
import { LeavesPage } from './fleet/LeavesPage'
import { AuxPage } from './fleet/AuxPage'
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
  // itemCountFor(page, mb).
  const nav = useFleetNav({
    itemCount: (page) => itemCountFor(page, mb) + (bannerVisible ? 1 : 0),
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
      const pageBaseCount = itemCountFor(nav.page, mb)
      if (bannerVisible && cursor === pageBaseCount) {
        dismissBanner()
        return
      }
      const actionId = resolveConfirmAction(nav.page, cursor, mb)
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
  // unreachable branch: mid-flip both fleet-host ports are down by design
  // (profile.sh stop_all), so reachable:false is the EXPECTED state of a
  // switch in progress — showing "unreachable" then would report a deliberate
  // action as an outage (observed on hardware, first live flip 2026-08-13).
  if (mb.switching) {
    const { target, phase, elapsedMs } = mb.switching
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-xl font-semibold text-amber-400">SWITCHING → {target === 'leaf-deep' ? 'LEAF-DEEP' : target.toUpperCase()}</div>
        <div className="mt-2 text-sm text-amber-400">{phase} · {Math.round(elapsedMs / 1000)}s</div>
      </div>
    )
  }

  if (!mb.reachable) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">FLEET-HOST</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">fleet-host unreachable</div>
      </div>
    )
  }

  // The banner's own cursor slot sits one past the active page's own items
  // -- see the itemCount/onConfirm comments above for why both must agree.
  const pageBaseCount = itemCountFor(nav.page, mb)
  const bannerIsCursor = bannerVisible && nav.cursor === pageBaseCount

  return (
    <div className="flex h-full flex-col" style={{ padding: '8px 12px' }}>
      <PageTabs page={nav.page} goToPage={nav.goToPage} />
      <div className="min-h-0 flex-1">
        {nav.page === 'seats' && (
          <SeatsPage
            mb={mb}
            serverNowMs={info.serverNowMs}
            cursor={nav.cursor}
            pending={pending}
            onTileTap={onTileTap}
            isLatched={isLatched}
          />
        )}
        {nav.page === 'leaves' && (
          <LeavesPage mb={mb} cursor={nav.cursor} pending={pending} onTileTap={onTileTap} isLatched={isLatched} />
        )}
        {nav.page === 'aux' && (
          <AuxPage mb={mb} cursor={nav.cursor} pending={pending} onTileTap={onTileTap} isLatched={isLatched} />
        )}
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
