import type { MbState } from '../../deviceInfo'
import { FILL_STYLE, iconUrl } from './shared'

type Props = {
  mb: MbState
  /** null while mb.switching is live -- MbSlot never renders this page then. */
  cursor: number | null
  pending: string | null
  /** See LeavesPage.tsx's Props doc -- same shared confirm/latch pipeline. */
  onTileTap: (actionId: string) => void
  isLatched: (actionId: string) => boolean
}

/** AUX — pcreate start/stop (the one verb here, ~180x110px tile matching the
 *  house idiom) + READ-ONLY liveness dots for the rest of mb.aux (Ruling 8:
 *  no start/stop verbs for lanes whose control surface we have not read). */
export function AuxPage({ mb, cursor, pending, onTileTap, isLatched }: Props) {
  const actionId = mb.pcreate ? 'mb.pcreate.stop' : 'mb.pcreate.start'
  const isPending = pending === actionId
  const latched = isLatched(actionId)
  const isCursor = cursor === 0
  const borderCls = isPending
    ? 'border-amber-400'
    : latched
      ? 'border-sky-400'
      : mb.pcreate
        ? 'border-emerald-400'
        : isCursor
          ? 'border-stone-400'
          : 'border-stone-800'
  const scrimAlpha = isPending ? 0.4 : mb.pcreate ? 0.45 : 0.68

  return (
    <div className="flex h-full flex-col" style={{ padding: '4px 0' }}>
      <div
        className={`relative flex shrink-0 flex-col items-center justify-center overflow-hidden border-2 rounded ${borderCls} cursor-pointer`}
        style={{ height: 110 }}
        onClick={() => onTileTap(actionId)}
      >
        <img
          src={iconUrl(mb.pcreate ? 'icon_mb_pcreate_active.png' : 'icon_mb_pcreate_inactive.png')}
          alt=""
          style={FILL_STYLE}
          className="h-full w-full object-cover"
        />
        <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${scrimAlpha})` }} />
        <div className="relative text-[10px] uppercase tracking-widest text-stone-400">PCREATE</div>
        <div className="relative text-sm font-semibold uppercase tracking-widest text-stone-200">{mb.pcreate ? 'STOP' : 'START'}</div>
        {isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-amber-400">TAP AGAIN</div>}
        {latched && !isPending && <div className="relative mt-0.5 text-[10px] uppercase tracking-widest text-sky-300">SENT</div>}
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-around">
        {mb.aux.map((a) => (
          <div key={a.id} className="flex flex-col items-center">
            <div className={`h-3 w-3 rounded-full ${a.up ? 'bg-emerald-400' : 'bg-stone-700'}`} />
            <div className="mt-1 text-[9px] uppercase tracking-widest text-stone-500">
              {a.id}:{a.port}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
