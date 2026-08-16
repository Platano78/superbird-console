/**
 * The visible half of "actions are inert but responsive" (ruling 4): a tap
 * in demo mode sends nothing, so it says so. Fixed to the bottom edge with
 * explicit left/right/bottom, never the banned `inset` shorthand.
 */

import { useInertNotice } from './inert'

export function DemoToast() {
  const notice = useInertNotice()
  if (!notice) return null
  return (
    <div
      className="pointer-events-none"
      style={{ position: 'fixed', left: 0, right: 0, bottom: 66, zIndex: 60, textAlign: 'center' }}
    >
      <span
        className="rounded border border-amber-400 bg-stone-900 px-3 py-1 text-[12px] font-semibold uppercase tracking-wider text-amber-300"
        style={{ display: 'inline-block' }}
      >
        {notice.text}
      </span>
    </div>
  )
}
