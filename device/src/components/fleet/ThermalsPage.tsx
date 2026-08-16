import type { FleetStateDoc, FleetThermalStatus } from '../../deviceInfo'
import { STALE_S, primaryHost } from './shared'

const STATUS_TONE: Record<FleetThermalStatus, string> = {
  ok: 'text-emerald-400',
  warm: 'text-amber-400',
  hot: 'text-orange-400',
  critical: 'text-red-400',
}

function StatTile({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="flex flex-col items-center justify-center border-2 rounded border-stone-800">
      <div className="text-[10px] uppercase tracking-widest text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-stone-50">
        {value === null ? '--' : `${Math.round(value * 10) / 10}${unit}`}
      </div>
    </div>
  )
}

/** THERMALS — new page (task item 3). The primary fleet host has zero fan tachometers
 *  and no OS-controllable PWM (verified 2026-08-15, BIOS/EC owns the curve),
 *  so `fan_rpm`/`pwm_pct` are null BY DESIGN, never rendered as a dead gauge
 *  or "N/A" -- switch on `fan_control` instead. Monitor-only: no navigable
 *  items (itemCountFor('thermals', ...) === 0). */
export function ThermalsPage({ doc }: { doc: FleetStateDoc | null }) {
  const host = primaryHost(doc ?? null)
  const t = host?.thermals ?? null

  if (!t) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-lg font-semibold uppercase tracking-widest text-stone-600">THERMALS UNAVAILABLE</div>
        <div className="mt-1 text-xs text-stone-700">node exporter not reporting</div>
      </div>
    )
  }

  const stale = (t.age_s ?? 0) > STALE_S
  const fanLine =
    t.fan_control === 'bios' ? 'FAN: BIOS-CONTROLLED' : t.fan_control === 'os' ? `FAN: ${t.pwm_pct ?? '--'}%` : 'FAN: UNKNOWN'

  return (
    <div className={`flex h-full flex-col ${stale ? 'opacity-60' : ''}`}>
      <div className="flex shrink-0 items-center justify-between">
        <div className={`text-lg font-bold uppercase tracking-widest ${STATUS_TONE[t.status] ?? 'text-stone-400'}`}>
          {t.status.toUpperCase()}
        </div>
        {stale && <div className="text-[10px] font-bold uppercase tracking-widest text-stone-500">STALE</div>}
      </div>

      <div
        className="flex-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 8, marginTop: 6 }}
      >
        <StatTile label="CPU TCTL" value={t.cpu_tctl_c} unit="°C" />
        <StatTile label="GPU EDGE" value={t.gpu_edge_c} unit="°C" />
        <StatTile label="GPU PWR" value={t.gpu_ppt_w} unit="W" />
        <StatTile label="GPU BUSY" value={t.gpu_busy_pct} unit="%" />
        <StatTile label="NVME" value={t.nvme_c} unit="°C" />
        <StatTile label="LOAD1" value={t.load1} unit="" />
      </div>

      <div className="mt-2 shrink-0 text-center text-xs uppercase tracking-widest text-stone-500">{fanLine}</div>
    </div>
  )
}
