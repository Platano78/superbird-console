import { useEffect, useRef, useState } from 'react'
import type { DeviceBlock, DeviceInfoState } from '../deviceInfo'

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
  return (
    <div
      role="button"
      onClick={() => onTap(id)}
      className={`flex flex-col items-center justify-center border-l border-t border-stone-800 px-1 text-center active:brightness-90 ${
        isLoaded ? 'bg-sky-950' : ''
      }`}
    >
      <div className="text-[9px] uppercase tracking-widest text-stone-500">{family}</div>
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
