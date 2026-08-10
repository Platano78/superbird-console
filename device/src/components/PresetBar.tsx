/**
 * Display-only reflection of the device's four physical preset buttons.
 * Slot 1 (SESSIONS) is the only app that exists — the rest must read as
 * "not built yet", never as a working tab, until their slices land.
 */
const SLOTS = ['SESSIONS', 'FLEET', 'QUEUE', 'CONTROL']

export function PresetBar() {
  return (
    <div className="grid h-[24px] shrink-0 grid-cols-4 border-t border-stone-800 bg-stone-950">
      {SLOTS.map((label, i) => (
        <div
          key={label}
          className={`flex items-center justify-center border-l border-stone-800 text-[11px] font-semibold tracking-wider first:border-l-0 ${
            i === 0 ? 'text-stone-50' : 'text-stone-500'
          }`}
        >
          {'①②③④'[i]} {label}
        </div>
      ))}
    </div>
  )
}
