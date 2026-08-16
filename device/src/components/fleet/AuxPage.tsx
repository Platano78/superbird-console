import type { FleetStateDoc, MbPcreate } from '../../deviceInfo'
import { FILL_STYLE, STALE_S, iconUrl, primaryHost } from './shared'

type Props = {
  doc: FleetStateDoc | null
  /** Controller-owned, NOT part of fleet-state/1 -- pcreate holds no seat
   *  and is not a leaf (contract §3), so this is a service the schema
   *  simply doesn't cover, not a producer-side truth being duplicated. See
   *  MbPcreate in deviceInfo.ts / the fleet-state contract §2.2, §3. */
  pcreate: MbPcreate
  /** null while mb.switching is live -- MbSlot never renders this page then. */
  cursor: number | null
  pending: string | null
  /** See LeavesPage.tsx's Props doc -- same shared confirm/latch pipeline. */
  onTileTap: (actionId: string) => void
  isLatched: (actionId: string) => boolean
}

/** AUX — pcreate's single start/stop toggle tile (same "stays actionable
 *  while active" rule as the herald seat tile: `pcreate.up===true` is
 *  precisely the state STOP must fire from) + READ-ONLY liveness for
 *  `host.aux[]` (tts-pocket/tts-qwen/asr-npu on the live producer), rendered
 *  by `state` same as seat tiles -- never a hardcoded `up` dot there. */
export function AuxPage({ doc, pcreate, cursor, pending, onTileTap, isLatched }: Props) {
  const host = primaryHost(doc ?? null)
  const actionId = pcreate.up ? 'mb.pcreate.stop' : 'mb.pcreate.start'
  const isPending = pending === actionId
  const latched = isLatched(actionId)
  const isCursor = cursor === 0
  const borderCls = isPending
    ? 'border-amber-400'
    : latched
      ? 'border-sky-400'
      : pcreate.up
        ? 'border-emerald-400'
        : isCursor
          ? 'border-stone-400'
          : 'border-stone-800'
  const scrimAlpha = isPending ? 0.4 : pcreate.up ? 0.45 : 0.68

  return (
    <div className="flex h-full flex-col" style={{ padding: '4px 0' }}>
      <div
        className={`relative flex shrink-0 flex-col items-center justify-center overflow-hidden border-2 rounded ${borderCls} cursor-pointer`}
        style={{ height: 110 }}
        onClick={() => onTileTap(actionId)}
      >
        <img
          src={iconUrl(pcreate.up ? 'icon_mb_pcreate_active.png' : 'icon_mb_pcreate_inactive.png')}
          alt=""
          style={FILL_STYLE}
          className="h-full w-full object-cover"
        />
        <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${scrimAlpha})` }} />
        <div className="relative text-[10px] uppercase tracking-widest text-stone-400">PCREATE</div>
        <div className="relative text-sm font-semibold uppercase tracking-widest text-stone-200">{pcreate.up ? 'STOP' : 'START'}</div>
        {isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-amber-400">TAP AGAIN</div>}
        {latched && !isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-sky-300">SENT</div>}
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-around">
        {(host?.aux ?? []).map((a) => {
          const stale = (a.age_s ?? 0) > STALE_S
          const dotCls = a.state === 'serving' ? (stale ? 'bg-stone-600' : 'bg-emerald-400') : a.state === 'loading' ? 'bg-amber-400' : 'bg-stone-700'
          return (
            <div key={a.id} className="flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full ${dotCls}`} />
              <div className="mt-1 text-[9px] uppercase tracking-widest text-stone-500">
                {a.label}:{a.port}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
