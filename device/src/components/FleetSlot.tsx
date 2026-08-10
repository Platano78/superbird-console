import { GaugeArc, type GaugeTone } from './GaugeArc'
import type { DeviceInfoState, DiskReading } from '../deviceInfo'

/** Same amber(>=75)/red(>=90) thresholds as GaugeArc's own bands. */
function diskTone(pct: number | null): GaugeTone {
  if (pct === null) return 'neutral'
  if (pct >= 90) return 'red'
  if (pct >= 75) return 'amber'
  return 'neutral'
}

function DiskGauge({ label, reading }: { label: string; reading: DiskReading }) {
  const pct = reading ? reading.usedPct : null
  return (
    <div className="flex flex-col items-center">
      <div style={{ display: 'grid' }} className="place-items-center">
        <div style={{ gridArea: '1 / 1' }}>
          <GaugeArc value={pct === null ? null : pct / 100} tone={diskTone(pct)} size={116} />
        </div>
        <div style={{ gridArea: '1 / 1' }} className="text-center leading-none">
          <div className="font-bold tabular-nums text-stone-50" style={{ fontSize: 22 }}>{pct !== null ? `${pct}%` : '--'}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-widest text-stone-500">used</div>
        </div>
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-stone-500">{label}</div>
    </div>
  )
}

type Props = { info: DeviceInfoState | null; reachable: boolean }

/** Slot 2 -- router/model, coder reachability, disk for / and /mnt/c. */
export function FleetSlot({ info, reachable }: Props) {
  if (!reachable || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <GaugeArc value={null} tone="neutral" size={140} />
        <div className="-mt-1 text-2xl font-semibold text-stone-400">FLEET</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }
  const { router, coder } = info.fleet
  const loadedLabel = router.available ? (router.loaded ?? 'IDLE') : '--'
  return (
    <div className="h-full" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', padding: '8px 12px' }}>
      <div className="flex flex-col justify-center border-l border-stone-800 pl-3 first:border-l-0">
        <div className="text-[10px] uppercase tracking-widest text-stone-500">router</div>
        <div className="mt-1 truncate text-lg font-semibold text-stone-50">{loadedLabel}</div>
        <div className="mt-1 text-xs tabular-nums text-stone-500">
          {router.available ? `${router.count} model${router.count === 1 ? '' : 's'}` : (router.error ?? 'unreachable')}
        </div>
        <div className="mt-4 text-[10px] uppercase tracking-widest text-stone-500">coder :8084</div>
        <div className={`mt-1 text-lg font-semibold ${coder.reachable ? 'text-emerald-400' : 'text-stone-600'}`}>
          {coder.reachable ? 'ONLINE' : 'OFFLINE'}
        </div>
      </div>
      <div className="flex items-center justify-center border-l border-stone-800">
        <DiskGauge label="/" reading={info.system.disk.root} />
      </div>
      <div className="flex items-center justify-center border-l border-stone-800">
        <DiskGauge label="/mnt/c" reading={info.system.disk.mntC} />
      </div>
    </div>
  )
}
