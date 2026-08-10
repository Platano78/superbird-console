import { GaugeArc } from './GaugeArc'

/**
 * Honest "not built yet" state for slots 2-4. No placeholder metrics, fake
 * gauges, or sample rows — an empty face (GaugeArc with value=null already
 * renders no reading) says "no data" truthfully; fabricating one would say
 * the opposite of what's true on a monitoring device.
 */
export function NotBuiltSlot({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <GaugeArc value={null} tone="neutral" size={140} />
      <div className="-mt-1 text-2xl font-semibold text-stone-400">{label}</div>
      <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">not implemented yet</div>
    </div>
  )
}
