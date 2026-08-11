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
// How long a tile stays in the transient ERROR treatment after a rejected
// (non-2xx) or failed-to-send action, before settling back to its steady
// state. NOT how loading ends -- that is driven purely by fleet.router.loading.
const ERROR_FLASH_MS = 5000

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

/** Actions fired recently, to swallow duplicate fires of the SAME id.
 *
 * ⚠ Observed 2026-08-11: tapping ROUTER repeatedly (because a start looks like
 * "nothing happened" for several seconds) fired router:start five times inside
 * 0.7s. They raced each other on binding port 8081 and the losers died with
 * "couldn't bind HTTP server socket" — so impatient tapping actively PREVENTED
 * the start it was trying to cause. The service returns 202 immediately by
 * design, so nothing else throttles this; the cooldown has to live here. */
const recentlyFired = new Set<string>()
const ACTION_COOLDOWN_MS = 8000

/**
 * Tiles are keyed by MODEL id (so `pending` can match a tile), but the service
 * takes NAMESPACED action ids. These are not the same string and conflating
 * them is a silent no-op.
 *
 * ⚠ Observed 2026-08-11: model tiles POSTed the bare model id and the service
 * answered `400 unknown action id: agents-qwen35-9b`. Because postAction was
 * fire-and-forget with an empty catch, the UI showed nothing at all — model
 * loading had NEVER worked, and every DRYRUN gate passed because they were
 * curl'd with the correct `load:` form the UI does not send. That silence is
 * also why the ERROR tone below exists now: a rejected action must be SEEN,
 * not just logged.
 */
function actionIdFor(tileId: string): string {
  if (tileId === 'kill' || tileId.startsWith('router:')) return tileId
  return `load:${tileId}`
}

/** `onFail`, when given, fires for a non-2xx response OR a network failure --
 *  the two ways an action can silently do nothing. Callers use it to flash
 *  the ERROR tone on the tile that was tapped (see useTransientError below). */
function postAction(id: string, onFail?: () => void) {
  if (recentlyFired.has(id)) return
  recentlyFired.add(id)
  window.setTimeout(() => recentlyFired.delete(id), ACTION_COOLDOWN_MS)
  void fetch(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then(async (res) => {
      // ⚠ Do NOT swallow a non-2xx. The response is not the success channel --
      // the /state poll is -- but a REJECTED action produces no state change at
      // all, so silence here is indistinguishable from "the button does
      // nothing". That is exactly how the `load:` prefix bug above survived.
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error(`[action] ${id} REJECTED ${res.status} ${body.slice(0, 120)}`)
        onFail?.()
      }
    })
    .catch((e) => {
      console.error(`[action] ${id} FAILED to send: ${e?.message ?? e}`)
      onFail?.()
    })
}

/** One shared confirm-arming hook for every tile in the grid -- a single
 *  `pending` id and a single timer, not one timer per tile (the device has
 *  488MB RAM; per-tile timers is exactly the kind of retained-state cost
 *  the spec calls out to avoid). `onFail(tileId)` is threaded through to
 *  postAction so a rejected/failed second tap can flash that tile red. */
function useConfirm(onFail: (tileId: string) => void) {
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
      postAction(actionIdFor(id), () => onFail(id))
      cancel()
      return
    }
    if (timer.current) window.clearTimeout(timer.current)
    setPending(id)
    timer.current = window.setTimeout(cancel, CONFIRM_TIMEOUT_MS)
  }

  return { pending, tap, cancel }
}

/** Transient ERROR flag -- one id, one timer, same shape as useConfirm above.
 *  Cleared purely by its own timeout; nothing here reads router state, so a
 *  slow-but-eventually-successful action doesn't get confused with a
 *  rejected one -- it just stops being red after ERROR_FLASH_MS. */
function useTransientError() {
  const [errorId, setErrorId] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const flash = (id: string) => {
    if (timer.current) window.clearTimeout(timer.current)
    setErrorId(id)
    timer.current = window.setTimeout(() => setErrorId(null), ERROR_FLASH_MS)
  }

  return { errorId, flash }
}

// Absolute-fill layers for the art + scrim -- explicit top/right/bottom/left,
// not Tailwind's `inset-0` utility, to stay clear of the banned `inset`
// shorthand CSS property regardless of how any given Tailwind version
// happens to compile that utility.
const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }
const LABEL_SHADOW: CSSProperties = { textShadow: '0 1px 3px rgba(0,0,0,0.9)' }

/**
 * Five-tone vocabulary, ported from the WigiDash LLM-launcher widget's own
 * state machine (WidgetInstance.cs ~750-790: flashState 1/2/3 = launching
 * (blue) / success (green) / error (red), layered on a steady Running
 * (green) / idle (gray) border) -- not invented here. `confirm` (amber) is
 * this app's own existing tap-to-arm convention, layered on top the same
 * way flashState layers on the steady state in the reference.
 *
 * Precedence when more than one could apply: confirm > error > loading >
 * loaded > idle. `loading` and `loaded` are driven ONLY by
 * fleet.router.loading/.loaded (real router state, polled); `error` is
 * driven ONLY by an actual rejected/failed fetch result, cleared by its own
 * timer -- NEITHER is a guess about how long an operation takes.
 */
type Tone = 'confirm' | 'error' | 'loading' | 'loaded' | 'idle'
const TONE_STYLE: Record<Tone, { border: string; scrimAlpha: number; label: string; sub: string }> = {
  confirm: { border: 'border-amber-400', scrimAlpha: 0.4, label: 'text-amber-200', sub: 'text-amber-300' },
  error: { border: 'border-red-500', scrimAlpha: 0.5, label: 'text-red-200', sub: 'text-red-300' },
  loading: { border: 'border-sky-500', scrimAlpha: 0.45, label: 'text-sky-200', sub: 'text-sky-300' },
  loaded: { border: 'border-emerald-500', scrimAlpha: 0.45, label: 'text-emerald-200', sub: 'text-emerald-400' },
  idle: { border: 'border-stone-800', scrimAlpha: 0.68, label: 'text-stone-100', sub: 'text-stone-500' },
}
/** Idle gets the reference's thin (2px in the source) gray border; every
 *  non-idle tone gets the thicker one -- width itself is a cue, not just
 *  colour, same as the C# reference's width 2 (idle) vs width 3 (everything
 *  else). */
function borderWidthClass(tone: Tone) {
  return tone === 'idle' ? 'border-l border-t' : 'border-l-2 border-t-2'
}

function toneFor({
  isPending,
  isError,
  isLoading,
  isLoaded,
  disabled,
}: {
  isPending: boolean
  isError: boolean
  isLoading: boolean
  isLoaded: boolean
  disabled: boolean
}): Tone {
  if (disabled) return 'idle'
  if (isPending) return 'confirm'
  if (isError) return 'error'
  if (isLoading) return 'loading'
  if (isLoaded) return 'loaded'
  return 'idle'
}

/** Full-bleed art tile for a model id present in MODEL_INFO. The source art
 *  is busy and bright at 256x256 shrunk into a ~190x100 tile -- the dark
 *  scrim is what keeps the label legible, not the art's own dimming. Active
 *  art plays for loading AND loaded (both are "this model is live or about
 *  to be"); inactive art plays for idle and error (error is "that attempt
 *  did not make this model live"). No filters/blurs on the image itself --
 *  a plain flat-colour overlay div is the entire treatment, cheap on 488MB. */
function ArtModelTile({
  id,
  name,
  info,
  isLoaded,
  isLoading,
  isPending,
  isError,
  disabled,
  onTap,
}: {
  id: string
  name: string
  info: { active: string; inactive: string }
  isLoaded: boolean
  isLoading: boolean
  isPending: boolean
  isError: boolean
  disabled: boolean
  onTap: (id: string) => void
}) {
  const tone = toneFor({ isPending, isError, isLoading, isLoaded, disabled })
  const style = TONE_STYLE[tone]
  const art = tone === 'loading' || tone === 'loaded' ? info.active : info.inactive
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onTap(id)
      }}
      className={`relative flex flex-col items-center justify-end overflow-hidden text-center ${
        disabled ? '' : 'active:brightness-90'
      } ${borderWidthClass(tone)} ${style.border}`}
    >
      <img src={iconUrl(art)} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
      <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${style.scrimAlpha})` }} />
      <div className="relative w-full px-1 pb-1">
        <div className={`truncate font-semibold ${style.label}`} style={{ ...LABEL_SHADOW, fontSize: 12, lineHeight: 1.15 }}>
          {name}
        </div>
        {tone === 'confirm' ? (
          <div className={`text-[10px] font-bold uppercase tracking-wide ${style.sub}`} style={LABEL_SHADOW}>
            CONFIRM?
          </div>
        ) : tone === 'error' ? (
          <div className={`text-[10px] font-bold uppercase tracking-wide ${style.sub}`} style={LABEL_SHADOW}>
            FAILED
          </div>
        ) : tone === 'loading' ? (
          <div className={`animate-breathe text-[9px] font-bold uppercase tracking-widest ${style.sub}`} style={LABEL_SHADOW}>
            LOADING
          </div>
        ) : (
          tone === 'loaded' && <div className="mx-auto mt-0.5 h-[2px] w-6 bg-emerald-400" />
        )}
      </div>
    </div>
  )
}

/** Text-only fallback for a model id NOT in MODEL_INFO -- honest
 *  degradation, never placeholder art. Same tone vocabulary as ArtModelTile,
 *  just without the image layer. */
function TextModelTile({
  id,
  loaded,
  loading,
  pending,
  errorId,
  disabled,
  onTap,
}: {
  id: string
  loaded: string | null
  loading: string | null
  pending: string | null
  errorId: string | null
  disabled: boolean
  onTap: (id: string) => void
}) {
  const { family, remainder } = familyOf(id)
  const tone = toneFor({
    isPending: pending === id,
    isError: errorId === id,
    isLoading: loading === id,
    isLoaded: loaded === id,
    disabled,
  })
  const style = TONE_STYLE[tone]
  const bg = tone === 'confirm' ? 'bg-amber-950' : tone === 'error' ? 'bg-red-950' : tone === 'loading' ? 'bg-sky-950' : tone === 'loaded' ? 'bg-emerald-950' : ''
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onTap(id)
      }}
      className={`flex flex-col items-center justify-center border-stone-800 px-1 text-center ${
        disabled ? '' : 'active:brightness-90'
      } ${borderWidthClass(tone)} ${bg}`}
    >
      <div className={`text-[9px] uppercase tracking-widest ${style.sub}`}>{family}</div>
      <div
        className={`mt-0.5 font-semibold ${style.label}`}
        style={{ fontSize: 12, lineHeight: 1.15, whiteSpace: 'normal', wordBreak: 'break-word' }}
      >
        {remainder}
      </div>
      {tone === 'confirm' ? (
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">CONFIRM?</div>
      ) : tone === 'error' ? (
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-red-300">FAILED</div>
      ) : tone === 'loading' ? (
        <div className="animate-breathe mt-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">LOADING</div>
      ) : (
        tone === 'loaded' && <div className="mt-1 h-[2px] w-6 bg-emerald-400" />
      )}
    </div>
  )
}

function ModelTile({
  id,
  loaded,
  loading,
  pending,
  errorId,
  disabled,
  onTap,
}: {
  id: string
  loaded: string | null
  loading: string | null
  pending: string | null
  errorId: string | null
  disabled: boolean
  onTap: (id: string) => void
}) {
  const info = MODEL_INFO[id]
  if (!info) return <TextModelTile id={id} loaded={loaded} loading={loading} pending={pending} errorId={errorId} disabled={disabled} onTap={onTap} />
  return (
    <ArtModelTile
      id={id}
      name={info.name}
      info={info}
      isLoaded={loaded === id}
      isLoading={loading === id}
      isPending={pending === id}
      isError={errorId === id}
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
          router: <span className={router.loaded ? 'text-emerald-300' : 'text-stone-500'}>{router.loaded ?? 'IDLE'}</span>
        </span>
      </span>
      <span className="tabular-nums text-stone-500">{router.count} models</span>
    </div>
  )
}

/**
 * Owner, verbatim: "if I am seeing router stop doesn't it mean its running?"
 * -- stacking a plain identity word ("ROUTER") over a plain verb ("STOP")
 * reads as either "the state IS stopped" or "tap to stop"; it fails at a
 * glance. Fix: the STATE is now a distinct bold word colour-coded by the
 * same tone vocabulary as the model tiles (RUNNING=green, STOPPED=gray),
 * and the ACTION is a separate glyph+word rendered as a small filled pill
 * -- a shape nothing else on this tile has, so it can only read as "tap
 * this". KILL gets the identical pill treatment for its action, per the
 * owner's "make them consistent" -- KILL has no separate state to show (it
 * IS the action), so only the pill part applies there. */
function ActionPill({ label, tone }: { label: string; tone: 'go' | 'stop' }) {
  return (
    <div
      className={`mt-0.5 inline-block rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-stone-50 ${
        tone === 'go' ? 'bg-emerald-700' : 'bg-red-700'
      }`}
      style={LABEL_SHADOW}
    >
      {tone === 'go' ? '▶ ' : '■ '}
      {label}
    </div>
  )
}

function KillTile({
  pending,
  errorId,
  disabled,
  onTap,
}: {
  pending: string | null
  errorId: string | null
  disabled: boolean
  onTap: (id: string) => void
}) {
  const tone = toneFor({ isPending: pending === 'kill', isError: errorId === 'kill', isLoading: false, isLoaded: false, disabled })
  return (
    <div
      role="button"
      onClick={() => {
        if (!disabled) onTap('kill')
      }}
      className={`relative flex flex-col items-center justify-end overflow-hidden text-center ${
        disabled ? '' : 'active:brightness-90'
      } ${borderWidthClass(tone)} ${TONE_STYLE[tone].border}`}
    >
      <img src={iconUrl(tone === 'confirm' ? 'icon_kill_active.png' : 'icon_kill_off.png')} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
      <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${disabled ? 0.82 : TONE_STYLE[tone].scrimAlpha})` }} />
      <div className="relative w-full px-1 pb-1">
        <div className={`text-lg font-bold tracking-widest ${disabled ? 'text-stone-600' : TONE_STYLE[tone].label}`} style={LABEL_SHADOW}>
          KILL
        </div>
        {tone === 'confirm' ? (
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300" style={LABEL_SHADOW}>
            CONFIRM?
          </div>
        ) : tone === 'error' ? (
          <div className="text-[10px] font-bold uppercase tracking-wide text-red-300" style={LABEL_SHADOW}>
            FAILED
          </div>
        ) : disabled ? (
          <div className="mt-0.5 inline-block rounded-sm bg-stone-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-stone-500">
            unload
          </div>
        ) : (
          <ActionPill label="unload" tone="stop" />
        )}
      </div>
    </div>
  )
}

/** The 12th cell: the one tile that is NEVER disabled by router-down, since
 *  it's the recovery action for exactly that state. STATE (RUNNING/STOPPED)
 *  and ACTION (the pill) are driven purely off `fleet.router.available` --
 *  no local state that could disagree with the service. */
function RouterToggleTile({
  available,
  pending,
  errorId,
  onTap,
}: {
  available: boolean
  pending: string | null
  errorId: string | null
  onTap: (id: string) => void
}) {
  const actionId = available ? 'router:stop' : 'router:start'
  const isPending = pending === actionId
  const isError = errorId === actionId
  const border = isPending ? 'border-amber-400' : isError ? 'border-red-500' : available ? 'border-emerald-500' : 'border-stone-800'
  const scrimAlpha = isPending || isError || available ? 0.45 : 0.68
  return (
    <div
      role="button"
      onClick={() => onTap(actionId)}
      className={`relative flex flex-col items-center justify-end overflow-hidden text-center active:brightness-90 ${
        isPending || isError || available ? 'border-l-2 border-t-2' : 'border-l border-t'
      } ${border}`}
    >
      <img
        src={iconUrl(available ? 'icon_router_active.png' : 'icon_router_off.png')}
        alt=""
        style={FILL_STYLE}
        className="h-full w-full object-cover"
      />
      <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${scrimAlpha})` }} />
      <div className="relative w-full px-1 pb-1">
        <div className="text-[9px] uppercase tracking-widest text-stone-400" style={LABEL_SHADOW}>
          router
        </div>
        <div
          className={`font-bold uppercase tracking-wide ${isError ? 'text-red-200' : available ? 'text-emerald-300' : 'text-stone-300'}`}
          style={{ ...LABEL_SHADOW, fontSize: 13 }}
        >
          {isError ? 'FAILED' : available ? 'RUNNING' : 'STOPPED'}
        </div>
        {isPending ? (
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300" style={LABEL_SHADOW}>
            CONFIRM?
          </div>
        ) : (
          <ActionPill label={available ? 'stop' : 'start'} tone={available ? 'stop' : 'go'} />
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

/** Slot 4 -- 10 model tiles (live roster, never hardcoded) + KILL + ROUTER +
 *  a rotating device-info strip. Five-tone vocabulary throughout: idle
 *  (gray) / loading (blue, router-driven) / loaded (green) / error (red,
 *  transient) / confirm (amber, local tap-arm) -- see TONE_STYLE above. */
export function ControlSlot({ info, reachable }: Props) {
  const { errorId, flash } = useTransientError()
  const { pending, tap, cancel } = useConfirm(flash)

  if (!reachable || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-stone-400">CONTROL</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }

  const { ids, loaded, loading, available } = info.fleet.router
  // Router-down: the service already 400s every model/kill action, so the
  // grid goes inert and ROUTER (never gated) is the only live control.
  const gridDisabled = !available
  // +2 -- KILL and the ROUTER toggle both occupy cells.
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
          <ModelTile key={id} id={id} loaded={loaded} loading={loading} pending={pending} errorId={errorId} disabled={gridDisabled} onTap={tap} />
        ))}
        <KillTile pending={pending} errorId={errorId} disabled={gridDisabled} onTap={tap} />
        <RouterToggleTile available={available} pending={pending} errorId={errorId} onTap={tap} />
        {Array.from({ length: fillerCount }).map((_, i) => (
          <div key={`filler-${i}`} className="border-l border-t border-stone-800" />
        ))}
      </div>
      <DeviceInfoStrip device={info.device} />
    </div>
  )
}
