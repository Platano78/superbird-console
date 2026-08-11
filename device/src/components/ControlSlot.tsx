import { useEffect, useRef, useState } from 'react'
import type { DeviceBlock, DeviceInfoState, RouterInfo } from '../deviceInfo'

const ACTION_URL = 'http://127.0.0.1:8791/action'
// A mis-tap here costs minutes of VRAM churn, not a security boundary --
// hence a plain tap-twice-within-a-window confirm, entirely local to this
// component. See CONTROL slice spec: "not security, cost."
const CONFIRM_TIMEOUT_MS = 4000
const ROTATE_MS = 4000

/** `agents-qwen35-9b` -> { family: 'AGENTS', remainder: 'qwen35-9b' }.
 *  `gemma4-26b` -> { family: 'GEMMA', remainder: '26b' } -- the trailing
 *  digit on some family prefixes (gemma4) is a version, not part of the
 *  family name, so it's stripped before uppercasing. */
function familyOf(id: string) {
  const first = id.split('-')[0] ?? id
  const family = first.replace(/\d+$/, '').toUpperCase()
  const remainder = id.slice(first.length + 1)
  return { family, remainder: remainder || first }
}

function postAction(id: string) {
  void fetch(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => {
    // Fire-and-forget by design -- the grid's own tile lighting (driven by
    // the next /state poll) is the feedback channel, not this promise.
  })
}

/** One shared confirm-arming hook for every tile in the grid -- a single
 *  `pending` id and a single timer, not one timer per tile (the device has
 *  488MB RAM; per-tile timers is exactly the kind of retained-state cost
 *  the spec calls out to avoid). */
function useConfirm() {
  const [pending, setPending] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    setPending(null)
  }

  const tap = (id: string) => {
    if (pending === id) {
      postAction(id)
      cancel()
      return
    }
    if (timer.current) window.clearTimeout(timer.current)
    setPending(id)
    timer.current = window.setTimeout(cancel, CONFIRM_TIMEOUT_MS)
  }

  return { pending, tap, cancel }
}

/**
 * Per-family wayfinding marks -- small, monochrome, `currentColor` so a
 * parent text-color class tints them the same as the family label. Plain
 * inline SVG only (no assets, no icon library, no filters/gradients/
 * animation) -- cheap pictograms, not illustrations, same idea as the
 * WigiDash widgets' procedurally-drawn icons.
 */
function IconAgents({ className }: { className?: string }) {
  // two peer nodes -- multiple agents, not one model
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" className={className}>
      <circle cx="5" cy="5" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="9" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function IconCoding({ className }: { className?: string }) {
  // angle brackets -- the one glyph nobody has to learn
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" className={className}>
      <path d="M4 3 L1 7 L4 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 3 L13 7 L10 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function IconGemma({ className }: { className?: string }) {
  // a facet-cut gem -- the name is literally "gem"
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" className={className}>
      <path d="M7 1 L13 5 L7 13 L1 5 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M1 5 L13 5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
function IconGeneral({ className }: { className?: string }) {
  // a plain circle -- no specialization, the universal shape
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" className={className}>
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function IconReasoning({ className }: { className?: string }) {
  // three chained nodes -- a step-by-step chain, not a single lookup
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" className={className}>
      <circle cx="2.5" cy="11.5" r="1.5" fill="currentColor" />
      <circle cx="7" cy="6" r="1.5" fill="currentColor" />
      <circle cx="11.5" cy="2.5" r="1.5" fill="currentColor" />
      <path d="M3.6 10.3 L5.9 7.3 M8.1 4.8 L10.4 3.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
const FAMILY_ICON: Record<string, (props: { className?: string }) => JSX.Element> = {
  AGENTS: IconAgents,
  CODING: IconCoding,
  GEMMA: IconGemma,
  GENERAL: IconGeneral,
  REASONING: IconReasoning,
}

function ModelTile({
  id,
  loaded,
  pending,
  onTap,
}: {
  id: string
  loaded: string | null
  pending: string | null
  onTap: (id: string) => void
}) {
  const { family, remainder } = familyOf(id)
  const isLoaded = loaded === id
  const isPending = pending === id
  const Icon = FAMILY_ICON[family]
  return (
    <div
      role="button"
      onClick={() => onTap(id)}
      className={`flex flex-col items-center justify-center border-l border-t border-stone-800 px-1 text-center active:brightness-90 ${
        isLoaded ? 'bg-sky-950' : ''
      }`}
    >
      {/* icon is wayfinding only -- the family label text stays the source
          of truth, no gap (flex gap is a no-op on this Chromium), margin
          on the label does the spacing instead */}
      <div className="flex items-center justify-center">
        {Icon && <Icon className={isLoaded ? 'text-sky-400' : 'text-stone-600'} />}
        <div className={`ml-1 text-[9px] uppercase tracking-widest ${isLoaded ? 'text-sky-300' : 'text-stone-500'}`}>{family}</div>
      </div>
      <div
        className={`mt-0.5 font-semibold ${isLoaded ? 'text-sky-300' : 'text-stone-100'}`}
        style={{ fontSize: 12, lineHeight: 1.15, whiteSpace: 'normal', wordBreak: 'break-word' }}
      >
        {remainder}
      </div>
      {isPending ? (
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">CONFIRM?</div>
      ) : (
        isLoaded && <div className="mt-1 h-[2px] w-6 bg-sky-400" />
      )}
    </div>
  )
}

/** The grid's status line, not a 12th tile -- what "the loaded tile lights
 *  up" doesn't convey: the state you're actually in when nothing is
 *  loaded. Same tone vocabulary as everywhere else: red only for an
 *  actual failure (router unreachable), neutral for the normal IDLE state. */
function RouterStatusLine({ router }: { router: RouterInfo }) {
  if (!router.available) {
    return (
      <div className="flex shrink-0 items-center justify-between border-b border-stone-800 px-2 py-1 text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-red-400">router unreachable</span>
        <span className="truncate text-stone-500">{router.error ?? 'unknown error'}</span>
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-stone-800 px-2 py-1 text-[11px]">
      <span className="font-semibold uppercase tracking-wide text-stone-300">
        router: <span className={router.loaded ? 'text-sky-300' : 'text-stone-500'}>{router.loaded ?? 'IDLE'}</span>
      </span>
      <span className="tabular-nums text-stone-500">{router.count} models</span>
    </div>
  )
}

function KillTile({ pending, onTap }: { pending: string | null; onTap: (id: string) => void }) {
  const isPending = pending === 'kill'
  return (
    <div
      role="button"
      onClick={() => onTap('kill')}
      className={`flex flex-col items-center justify-center border-l border-t border-stone-800 px-1 text-center active:brightness-90 ${
        isPending ? 'bg-red-950' : ''
      }`}
    >
      <div className={`text-lg font-bold tracking-widest ${isPending ? 'text-red-300' : 'text-stone-400'}`}>KILL</div>
      <div className="text-[9px] uppercase tracking-widest text-stone-600">{isPending ? 'CONFIRM?' : 'unload'}</div>
    </div>
  )
}

/** device.uptime.raw etc. are pre-formatted strings/numbers off real reads
 *  -- this just picks which one to show and formats units, no re-parsing. */
function strip(device: DeviceBlock) {
  if ('error' in device) return `device info unavailable: ${device.error}`
  return null
}

const READINGS: { label: string; render: (d: Extract<DeviceBlock, { tempC: number | null }>) => string }[] = [
  { label: 'temp', render: (d) => (d.tempC !== null ? `${d.tempC.toFixed(1)}°C` : '--') },
  {
    label: 'load',
    render: (d) => (d.uptime.load1 !== null ? `${d.uptime.load1} ${d.uptime.load5} ${d.uptime.load15}` : '--'),
  },
  {
    label: 'mem',
    render: (d) => (d.memory ? `${d.memory.usedMb}M / ${d.memory.totalMb}M` : '--'),
  },
  { label: 'disk', render: (d) => (d.disk ? `${d.disk.avail} free (${d.disk.usePct})` : '--') },
  { label: 'backlight', render: (d) => (d.backlight !== null ? `${d.backlight}/255` : '--') },
]

function DeviceInfoStrip({ device }: { device: DeviceBlock }) {
  const [idx, setIdx] = useState(0)
  // One timer for the strip's own lifetime -- not one per reading.
  useEffect(() => {
    const t = setInterval(() => setIdx((n) => (n + 1) % READINGS.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [])

  const unavailable = strip(device)
  if (unavailable) {
    return <div className="shrink-0 border-t border-stone-800 py-1.5 text-center text-[11px] text-stone-600">{unavailable}</div>
  }
  const reading = READINGS[idx]
  return (
    <div className="shrink-0 border-t border-stone-800 py-1.5 text-center">
      <span className="text-[10px] uppercase tracking-widest text-stone-500">{reading.label}</span>
      <span className="ml-2 text-sm font-semibold tabular-nums text-stone-200">
        {reading.render(device as Extract<DeviceBlock, { tempC: number | null }>)}
      </span>
    </div>
  )
}

type Props = { info: DeviceInfoState | null; reachable: boolean }

/** Slot 4 -- 10 model tiles (live roster, never hardcoded) + KILL + a
 *  rotating device-info strip. Only the loaded model's tile lights, which
 *  makes KILL legible: it darkens everything. */
export function ControlSlot({ info, reachable }: Props) {
  const { pending, tap, cancel } = useConfirm()

  if (!reachable || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-stone-400">CONTROL</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }

  const { ids, loaded } = info.fleet.router
  const fillerCount = ids.length > 0 ? (4 - ((ids.length + 1) % 4)) % 4 : 0

  return (
    <div className="flex h-full flex-col">
      <RouterStatusLine router={info.fleet.router} />
      <div
        className="flex-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: '1fr' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) cancel()
        }}
      >
        {ids.map((id) => (
          <ModelTile key={id} id={id} loaded={loaded} pending={pending} onTap={tap} />
        ))}
        <KillTile pending={pending} onTap={tap} />
        {Array.from({ length: fillerCount }).map((_, i) => (
          <div key={`filler-${i}`} className="border-l border-t border-stone-800" />
        ))}
      </div>
      <DeviceInfoStrip device={info.device} />
    </div>
  )
}
