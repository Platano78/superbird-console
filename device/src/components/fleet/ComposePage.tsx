/**
 * COMPOSE -- Phase D placeholder. Phase D (the ad-hoc multi-model launcher)
 * is BLOCKED on a fleet-host-side script that does not exist yet (Ruling
 * 12: `~/compose.sh` or a new `profile.sh` verb, owned by fleet-aggregator, reviewed
 * separately). This page renders as an explicitly DISABLED placeholder with
 * its blocking reason -- never a dead tile that silently no-ops. It carries
 * no navigable items (itemCountFor('compose', ...) === 0 in shared.ts), so
 * the cursor can never land on anything confirmable here.
 */
export function ComposePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center border-2 rounded border-stone-800">
      <div className="text-2xl font-bold uppercase tracking-widest text-stone-600">COMPOSE</div>
      <div className="mt-2 rounded bg-stone-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-stone-500">
        DISABLED
      </div>
      <div className="mt-3 text-xs text-stone-600">blocked: fleet-host launcher not built</div>
    </div>
  )
}
