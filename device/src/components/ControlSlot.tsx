import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { DeviceBlock, DeviceInfoState, RouterInfo } from '../deviceInfo'

// Icons are PLAIN RUNTIME STRINGS, resolved document-relative at render
// time (`./icons/<file>` -> `iconUrl()` below) -- NOT ES-module asset
// imports. `import ... from '.../foo.png'` compiles to `new URL(asset,
// import.meta.url)`, and that constructor is not present in the legacy/
// SystemJS shim this Chromium 69 kiosk executes -- it throws mid-module-
// execution and blank-screens the ENTIRE app, not just the icons (verified
// on device: `TypeError: nd is not a constructor`). The files live in
// `public/icons/` (Vite copies `public/` verbatim to the output root) and
// are referenced only as strings from here on.
function iconUrl(file: string) {
  return `./icons/${file}`
}

const ACTION_URL = 'http://127.0.0.1:8791/action'
// A mis-tap here costs minutes of VRAM churn, not a security boundary --
// hence a plain tap-twice-within-a-window confirm, entirely local to this
// component. See CONTROL slice spec: "not security, cost."
const CONFIRM_TIMEOUT_MS = 4000
const ROTATE_MS = 4000

/** `agents-qwen35-9b` -> { family: 'AGENTS', remainder: 'qwen35-9b' } --
 *  kept only as the text-fallback path for a model id absent from
 *  MODEL_INFO below (honest degradation: no placeholder art for an
 *  unknown id, not a missing tile). */
function familyOf(id: string) {
  const first = id.split('-')[0] ?? id
  const family = first.replace(/\d+$/, '').toUpperCase()
  const remainder = id.slice(first.length + 1)
  return { family, remainder: remainder || first }
}

/**
 * The authoritative model -> {display name, art} mapping, per the owner's
 * table (sourced from the live WigiDash LLM-control widget's own shipped
 * config -- this is not invented). `icon_qwen35_35b_*` is deliberately
 * shared by two entries; that's how the source config does it. The
 * inactive-state suffix is inconsistent upstream (`_off` vs `_inactive`),
 * so each entry spells out its own exact filename rather than deriving one
 * by string concatenation.
 */
const MODEL_INFO: Record<string, { name: string; active: string; inactive: string }> = {
  'agents-qwen35-9b': { name: 'Qwen3.5', active: 'icon_qwen35_active.png', inactive: 'icon_qwen35_off.png' },
  'coding-nouscoder-14b': { name: 'NousCoder', active: 'icon_glm_active.png', inactive: 'icon_glm_off.png' },
  'coding-qwen3-next': { name: 'QCN 80B', active: 'icon_qcn_active.png', inactive: 'icon_qcn_off.png' },
  'gemma4-26b': { name: 'Gemma4 26B', active: 'icon_gemma4_26b_active.png', inactive: 'icon_gemma4_26b_inactive.png' },
  'gemma4-31b': { name: 'Gemma4 31B', active: 'icon_gemma4_31b_active.png', inactive: 'icon_gemma4_31b_inactive.png' },
  'general-qwen36-35b': { name: 'Q3.6 35B', active: 'icon_qwen35_35b_active.png', inactive: 'icon_qwen35_35b_off.png' },
  'reasoning-bonsai-27b-ternary': { name: 'Bonsai 262K', active: 'icon_seedcoder_active.png', inactive: 'icon_seedcoder_off.png' },
  'reasoning-cascade2': { name: 'Cascade 2', active: 'icon_nemotron_active.png', inactive: 'icon_nemotron_off.png' },
  'reasoning-qwen36-27b-mtp': { name: 'Q3.6 27B MTP', active: 'icon_qwen35_35b_active.png', inactive: 'icon_qwen35_35b_off.png' },
  'reasoning-qwen36-27b-heretic-q3km-mtp': { name: 'Q3.6 27B DAU', active: 'icon_davidau_active.png', inactive: 'icon_davidau_inactive.png' },
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

// Absolute-fill layers for the art + scrim -- explicit top/right/bottom/left,
// not Tailwind's `inset-0` utility, to stay clear of the banned `inset`
// shorthand CSS property regardless of how any given Tailwind version
// happens to compile that utility.
const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }
const LABEL_SHADOW: CSSProperties = { textShadow: '0 1px 3px rgba(0,0,0,0.9)' }

/** Full-bleed art tile for a model id present in MODEL_INFO. The source art
 *  is busy and bright at 256x256 shrunk into a ~190x100 tile -- the dark
 *  scrim is what keeps the label legible, not the art's own dimming (the
 *  inactive PNGs are already grayscale at source, but still get the
 *  HEAVIER scrim per the owner's ruling: not-loaded should read as more
 *  muted, not less -- loaded gets the lighter one as the "this is live"
 *  cue). No filters/blurs on the image itself -- a plain flat-colour
 *  overlay div is the entire treatment, cheap on 488MB. */
function ArtModelTile({
  id,
  name,
  art,
  isLoaded,
  isPending,
  disabled,
  onTap,
}: {
  id: string
  name: string
  art: string
  isLoaded: boolean
  isPending: boolean
  disabled: boolean
  onTap: (id: string) => void
}) {
  // Router-down state: the service already 400s these, so make that visible
  // rather than leaving a dead-looking-alive tile -- heavier scrim, muted
  // label, no confirm arming (the onClick guard below is what actually
  // prevents it firing; the visuals just make that true at a glance).
  const lit = !disabled && isLoaded
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onTap(id)
      }}
      className={`relative flex flex-col items-center justify-end overflow-hidden border-l border-t text-center ${
        disabled ? '' : 'active:brightness-90'
      } ${lit ? 'border-sky-500' : 'border-stone-800'}`}
    >
      <img src={iconUrl(art)} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
      <div
        style={{
          ...FILL_STYLE,
          background: disabled ? 'rgba(12,10,9,0.82)' : lit ? 'rgba(12,10,9,0.45)' : 'rgba(12,10,9,0.68)',
        }}
      />
      <div className="relative w-full px-1 pb-1">
        <div
          className={`truncate font-semibold ${disabled ? 'text-stone-500' : lit ? 'text-sky-200' : 'text-stone-100'}`}
          style={{ ...LABEL_SHADOW, fontSize: 12, lineHeight: 1.15 }}
        >
          {name}
        </div>
        {!disabled && isPending ? (
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300" style={LABEL_SHADOW}>
            CONFIRM?
          </div>
        ) : (
          lit && <div className="mx-auto mt-0.5 h-[2px] w-6 bg-sky-400" />
        )}
      </div>
    </div>
  )
}

/** Text-only fallback for a model id NOT in MODEL_INFO -- honest
 *  degradation, never placeholder art. Same look the whole grid had before
 *  this slice, minus the (now-removed) per-family SVG mark. */
function TextModelTile({
  id,
  loaded,
  pending,
  disabled,
  onTap,
}: {
  id: string
  loaded: string | null
  pending: string | null
  disabled: boolean
  onTap: (id: string) => void
}) {
  const { family, remainder } = familyOf(id)
  const lit = !disabled && loaded === id
  const isPending = !disabled && pending === id
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onTap(id)
      }}
      className={`flex flex-col items-center justify-center border-l border-t border-stone-800 px-1 text-center ${
        disabled ? '' : 'active:brightness-90'
      } ${lit ? 'bg-sky-950' : ''}`}
    >
      <div className={`text-[9px] uppercase tracking-widest ${disabled ? 'text-stone-700' : lit ? 'text-sky-300' : 'text-stone-500'}`}>
        {family}
      </div>
      <div
        className={`mt-0.5 font-semibold ${disabled ? 'text-stone-600' : lit ? 'text-sky-300' : 'text-stone-100'}`}
        style={{ fontSize: 12, lineHeight: 1.15, whiteSpace: 'normal', wordBreak: 'break-word' }}
      >
        {remainder}
      </div>
      {isPending ? (
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">CONFIRM?</div>
      ) : (
        lit && <div className="mt-1 h-[2px] w-6 bg-sky-400" />
      )}
    </div>
  )
}

function ModelTile({
  id,
  loaded,
  pending,
  disabled,
  onTap,
}: {
  id: string
  loaded: string | null
  pending: string | null
  disabled: boolean
  onTap: (id: string) => void
}) {
  const info = MODEL_INFO[id]
  if (!info) return <TextModelTile id={id} loaded={loaded} pending={pending} disabled={disabled} onTap={onTap} />
  const isLoaded = loaded === id
  const isPending = pending === id
  return (
    <ArtModelTile
      id={id}
      name={info.name}
      art={isLoaded ? info.active : info.inactive}
      isLoaded={isLoaded}
      isPending={isPending}
      disabled={disabled}
      onTap={onTap}
    />
  )
}

/** The grid's status line, not a 12th tile -- what "the loaded tile lights
 *  up" doesn't convey: the state you're actually in when nothing is
 *  loaded. Same tone vocabulary as everywhere else: red only for an
 *  actual failure (router unreachable), neutral for the normal IDLE state.
 *  The small router icon is a non-full-bleed prefix mark, not a tile. */
function RouterStatusLine({ router }: { router: RouterInfo }) {
  if (!router.available) {
    return (
      <div className="flex shrink-0 items-center justify-between border-b border-stone-800 px-2 py-1 text-[11px]">
        <span className="flex items-center">
          <img src={iconUrl('icon_router_off.png')} alt="" className="mr-1 h-[14px] w-[14px]" />
          <span className="font-semibold uppercase tracking-wide text-red-400">router unreachable</span>
        </span>
        <span className="truncate text-stone-500">{router.error ?? 'unknown error'}</span>
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-stone-800 px-2 py-1 text-[11px]">
      <span className="flex items-center">
        <img src={iconUrl(router.loaded ? 'icon_router_active.png' : 'icon_router_off.png')} alt="" className="mr-1 h-[14px] w-[14px]" />
        <span className="font-semibold uppercase tracking-wide text-stone-300">
          router: <span className={router.loaded ? 'text-sky-300' : 'text-stone-500'}>{router.loaded ?? 'IDLE'}</span>
        </span>
      </span>
      <span className="tabular-nums text-stone-500">{router.count} models</span>
    </div>
  )
}

function KillTile({ pending, disabled, onTap }: { pending: string | null; disabled: boolean; onTap: (id: string) => void }) {
  const isPending = !disabled && pending === 'kill'
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onTap('kill')
      }}
      className={`relative flex flex-col items-center justify-end overflow-hidden border-l border-t text-center ${
        disabled ? '' : 'active:brightness-90'
      } ${isPending ? 'border-red-500' : 'border-stone-800'}`}
    >
      <img src={iconUrl(isPending ? 'icon_kill_active.png' : 'icon_kill_off.png')} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
      <div style={{ ...FILL_STYLE, background: disabled ? 'rgba(12,10,9,0.82)' : isPending ? 'rgba(12,10,9,0.4)' : 'rgba(12,10,9,0.68)' }} />
      <div className="relative w-full px-1 pb-1">
        <div
          className={`text-lg font-bold tracking-widest ${disabled ? 'text-stone-600' : isPending ? 'text-red-300' : 'text-stone-100'}`}
          style={LABEL_SHADOW}
        >
          KILL
        </div>
        <div className={`text-[9px] uppercase tracking-widest ${disabled ? 'text-stone-600' : 'text-stone-300'}`} style={LABEL_SHADOW}>
          {isPending ? 'CONFIRM?' : 'unload'}
        </div>
      </div>
    </div>
  )
}

/** The 12th cell: the one tile that is NEVER disabled by router-down, since
 *  it's the recovery action for exactly that state. Toggle driven purely
 *  off `fleet.router.available` -- no local state that could disagree with
 *  the service. Label always spells out the action (START/STOP), never
 *  just a state name, so there's no guessing which way a tap goes. */
function RouterToggleTile({
  available,
  pending,
  onTap,
}: {
  available: boolean
  pending: string | null
  onTap: (id: string) => void
}) {
  const actionId = available ? 'router:stop' : 'router:start'
  const isPending = pending === actionId
  return (
    <div
      role="button"
      onClick={() => onTap(actionId)}
      className={`relative flex flex-col items-center justify-end overflow-hidden border-l border-t text-center active:brightness-90 ${
        available ? 'border-sky-500' : 'border-stone-800'
      }`}
    >
      <img
        src={iconUrl(available ? 'icon_router_active.png' : 'icon_router_off.png')}
        alt=""
        style={FILL_STYLE}
        className="h-full w-full object-cover"
      />
      <div style={{ ...FILL_STYLE, background: available ? 'rgba(12,10,9,0.45)' : 'rgba(12,10,9,0.68)' }} />
      <div className="relative w-full px-1 pb-1">
        <div className={`font-semibold ${available ? 'text-sky-200' : 'text-stone-100'}`} style={{ ...LABEL_SHADOW, fontSize: 12, lineHeight: 1.15 }}>
          ROUTER
        </div>
        {isPending ? (
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300" style={LABEL_SHADOW}>
            CONFIRM?
          </div>
        ) : (
          <div className="text-[9px] uppercase tracking-widest text-stone-300" style={LABEL_SHADOW}>
            {available ? 'STOP' : 'START'}
          </div>
        )}
      </div>
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
 *  rotating device-info strip. Only the loaded model's tile shows the
 *  brighter "active" art (lighter scrim, sky border), which is what makes
 *  KILL legible: it darkens everything back to the "off" treatment. */
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

  const { ids, loaded, available } = info.fleet.router
  // Router-down: the service already 400s every model/kill action, so the
  // grid goes inert and ROUTER (never gated) is the only live control.
  const gridDisabled = !available
  // +2 now, not +1 -- KILL and the new ROUTER toggle both occupy cells.
  const fillerCount = ids.length > 0 ? (4 - ((ids.length + 2) % 4)) % 4 : 0

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
          <ModelTile key={id} id={id} loaded={loaded} pending={pending} disabled={gridDisabled} onTap={tap} />
        ))}
        <KillTile pending={pending} disabled={gridDisabled} onTap={tap} />
        <RouterToggleTile available={available} pending={pending} onTap={tap} />
        {Array.from({ length: fillerCount }).map((_, i) => (
          <div key={`filler-${i}`} className="border-l border-t border-stone-800" />
        ))}
      </div>
      <DeviceInfoStrip device={info.device} />
    </div>
  )
}
