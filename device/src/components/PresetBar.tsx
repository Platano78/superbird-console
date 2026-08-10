/**
 * Live reflection of the device's four physical preset buttons — also
 * tappable, routed through the same `onSelect` the hardware keys use so
 * there is exactly one slot-switching code path.
 */
const SLOTS = ['SESSIONS', 'FLEET', 'QUEUE', 'CONTROL']

type Props = { activeSlot: number; onSelect: (slot: number) => void }

export function PresetBar({ activeSlot, onSelect }: Props) {
  return (
    <div className="grid h-[24px] shrink-0 grid-cols-4 border-t border-stone-800 bg-stone-950">
      {SLOTS.map((label, i) => {
        const slot = i + 1
        const active = slot === activeSlot
        return (
          <div
            key={label}
            role="button"
            onClick={() => onSelect(slot)}
            className={`flex items-center justify-center border-l border-stone-800 text-[11px] font-semibold tracking-wider first:border-l-0 ${
              active ? 'bg-stone-800 text-stone-50' : 'text-stone-500'
            }`}
          >
            {'①②③④'[i]} {label}
          </div>
        )
      })}
    </div>
  )
}
