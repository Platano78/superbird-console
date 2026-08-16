import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { DeviceBlock, DeviceInfoState } from '../deviceInfo'
import { requestFastPoll } from '../deviceInfo'
import { DEMO_FORCED, isDemoActive } from '../demo/demoMode'
import { DEMO_BUTTONS } from '../demo/fixtures.buttons'
import { inertAction } from '../demo/inert'

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
const CONFIG_URL = 'http://127.0.0.1:8791/config'
const CONFIG_FETCH_TIMEOUT_MS = 4500
// A mis-tap here costs minutes of VRAM churn, not a security boundary --
// hence a plain tap-twice-within-a-window confirm for buttons the config
// flags `confirm: true`. Entirely local to this component.
const CONFIRM_TIMEOUT_MS = 4000
const ROTATE_MS = 4000
// How long a tile stays in the transient ERROR treatment after a rejected
// (non-2xx) or failed-to-send action, before settling back to its steady
// state. NOT how loading ends -- that is driven purely by fleet.router.loading.
const ERROR_FLASH_MS = 5000
// How long LOCAL optimism ("I just tapped this") is allowed to stand in for
// real router state before giving up and flashing an error. Generous on
// purpose -- router-control.sh switch unloads the previous model first, and
// that alone can take a while. This timer can ONLY cancel the local guess;
// it is disarmed the instant real state (loading OR loaded) shows up, and
// can never override or cancel an already-acknowledged load.
const OPTIMISTIC_GIVEUP_MS = 45000

/**
 * The CONTROL grid's shape, straight from services/deviceinfo/buttons.json
 * via GET /config -- NEVER hardcoded here. Array order IS grid order, so
 * adding/reordering a button is a JSON edit on the host, not a rebuild.
 * The service strips `argv`/`stopArgv` before sending this; the device
 * only ever holds an opaque id, never the command behind it.
 */
export type ButtonConfig = {
  id: string
  displayName: string
  subLabel?: string
  kind: 'model' | 'action' | 'toggle'
  expectedModel?: string
  requiresRouter?: boolean
  requiresLoadedModel?: boolean
  confirm?: boolean
  icons: { active: string; inactive: string }
}

/** One-shot fetch on mount -- not a poll. While unavailable (fetch failed,
 *  timed out, or config not yet loaded), callers render the honest
 *  unavailable panel rather than guessing a grid. */
function useButtonsConfig() {
  const [buttons, setButtons] = useState<ButtonConfig[] | null>(null)
  useEffect(() => {
    // 🔴 DEMO GUARD: forced demo issues no /config request either; the
    // caller substitutes DEMO_BUTTONS below.
    if (DEMO_FORCED) return
    let cancelled = false
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), CONFIG_FETCH_TIMEOUT_MS)
    async function load() {
      try {
        const res = await fetch(CONFIG_URL, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`http ${res.status}`)
        const body = await res.json()
        if (!cancelled && Array.isArray(body?.buttons)) setButtons(body.buttons)
      } catch {
        // stays null -- render() below shows the unavailable panel
      } finally {
        clearTimeout(timer)
      }
    }
    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])
  return buttons
}

/** Actions fired recently, to swallow duplicate fires of the SAME id.
 *
 * ⚠ Observed 2026-08-11: tapping ROUTER repeatedly (because a start looks like
 * "nothing happened" for several seconds) fired router:start five times inside
 * 0.7s. They raced each other on binding port 8081 and the losers died with
 * "couldn't bind HTTP server socket" — so impatient tapping actively PREVENTED
 * the start it was trying to cause. The service returns 202 immediately by
 * design, so nothing else throttles this; the cooldown has to live here.
 * Applies to every button now, confirm-gated or not -- a direct-fire model
 * tap can race itself the same way. */
const recentlyFired = new Set<string>()
const ACTION_COOLDOWN_MS = 8000

/** `onFail`, when given, fires for a non-2xx response OR a network failure --
 *  the two ways an action can silently do nothing. Callers use it to flash
 *  the ERROR tone on the tile that was tapped. The id posted is the config
 *  button's OWN id, verbatim -- no prefixing, no `load:`/`kill`/`router:`
 *  namespacing convention. That convention was the earlier silent-no-op
 *  bug: tiles POSTed the bare model id, the service expected `load:<id>`,
 *  and an empty catch swallowed the resulting 400 with no UI feedback at
 *  all. One string, one meaning now. */
function postAction(id: string, onFail?: () => void) {
  // 🔴 DEMO GUARD (ruling 4): nothing is posted in demo mode. Returns before
  // the cooldown set is touched, so demo taps leave no state behind at all.
  if (inertAction(id)) return
  if (recentlyFired.has(id)) return
  recentlyFired.add(id)
  window.setTimeout(() => recentlyFired.delete(id), ACTION_COOLDOWN_MS)
  // Close the real-state gap from the polling side too -- see deviceInfo.ts.
  requestFastPoll()
  void fetch(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
    .then(async (res) => {
      // ⚠ Do NOT swallow a non-2xx. The response is not the success channel --
      // the /state poll is -- but a REJECTED action produces no state change at
      // all, so silence here is indistinguishable from "the button does
      // nothing".
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

/** One shared confirm-arming hook for every `confirm: true` button in the
 *  grid -- a single `pending` id and a single timer, not one timer per
 *  tile (the device has 488MB RAM; per-tile timers is exactly the kind of
 *  retained-state cost the spec calls out to avoid). Purely about the
 *  arm/timeout state -- firing (postAction, optimistic-start, fast-poll)
 *  is the caller's job, decided by `tap`'s return value: true means "this
 *  was the confirming tap, fire now", false means "just armed". */
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

  const tap = (id: string): boolean => {
    if (pending === id) {
      cancel()
      return true
    }
    if (timer.current) window.clearTimeout(timer.current)
    setPending(id)
    timer.current = window.setTimeout(cancel, CONFIRM_TIMEOUT_MS)
    return false
  }

  return { pending, tap, cancel }
}

/** Optimistic in-flight tracking for ONE model tile at a time (only one
 *  model can ever be loading). The instant a fire happens locally, we know
 *  it with zero uncertainty -- no reason to wait on a round trip to show
 *  it. Ends the instant real state (loading OR loaded) matches -- see the
 *  render-time guard in ModelTile, which self-corrects without waiting for
 *  the effect below; the effect's only job is disarming OPTIMISTIC_GIVEUP_MS
 *  so it can never fire against an acknowledged load. */
function useOptimisticLoad() {
  const [optimistic, setOptimistic] = useState<{ id: string; expectedModel: string } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const start = (id: string, expectedModel: string, onGiveUp: (id: string) => void) => {
    if (timer.current) window.clearTimeout(timer.current)
    setOptimistic({ id, expectedModel })
    timer.current = window.setTimeout(() => {
      timer.current = null
      setOptimistic(null)
      onGiveUp(id)
    }, OPTIMISTIC_GIVEUP_MS)
  }

  const clear = () => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    setOptimistic(null)
  }

  return { optimistic, start, clear }
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
 *  colour. */
function borderWidthClass(tone: Tone) {
  return tone === 'idle' ? 'border-l border-t' : 'border-l-2 border-t-2'
}

/**
 * ONE place that decides both a model tile's TONE and whether it is
 * TAPPABLE, so the two can't disagree (today's bugs all came from two code
 * paths deciding the same thing differently).
 *
 * Owner ruling 2026-08-11: `router-control.sh switch` unloads whatever is
 * loaded OR loading and reloads from scratch -- so tapping the tile that IS
 * the current model does a full unload+reload of the SAME model for zero
 * change, and a mis-tap is indistinguishable from an intentional reload.
 * A tile matching `loaded` or `loading` is therefore never tappable -- but
 * it must still read as "this is already the case" (full loaded/loading
 * tone), NOT "you cannot do this right now" (the router-down `disabled`
 * treatment, which is a DIFFERENT reason to be inert and must look
 * different). `disabled` forces tone to idle; loaded/loading do not.
 */
function resolveModelTile({
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
}): { tone: Tone; tappable: boolean } {
  if (disabled) return { tone: 'idle', tappable: false }
  if (isPending) return { tone: 'confirm', tappable: true }
  if (isError) return { tone: 'error', tappable: true }
  if (isLoading) return { tone: 'loading', tappable: false }
  if (isLoaded) return { tone: 'loaded', tappable: false }
  return { tone: 'idle', tappable: true }
}

/** Shared shell for every tile kind -- full-bleed art + flat-colour scrim +
 *  a relative content layer, the one piece of markup all three kinds
 *  otherwise duplicated identically. Each kind supplies its own label
 *  content as children and its own tone-derived border/scrim/art. */
function TileFrame({
  tappable,
  borderClass,
  scrimAlpha,
  art,
  onClick,
  children,
}: {
  tappable: boolean
  borderClass: string
  scrimAlpha: number
  art: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div
      role="button"
      onClick={onClick}
      className={`relative flex flex-col items-center justify-end overflow-hidden text-center ${tappable ? 'active:brightness-90' : ''} ${borderClass}`}
    >
      <img src={iconUrl(art)} alt="" style={FILL_STYLE} className="h-full w-full object-cover" />
      <div style={{ ...FILL_STYLE, background: `rgba(12,10,9,${scrimAlpha})` }} />
      <div className="relative w-full px-1 pb-1">{children}</div>
    </div>
  )
}

/** Full-bleed art tile for a `kind: "model"` config entry. The source art
 *  is busy and bright at 256x256 shrunk into a ~190x100 tile -- the dark
 *  scrim is what keeps the label legible, not the art's own dimming. Active
 *  art plays for loading AND loaded (both are "this model is live or about
 *  to be"); inactive art plays for idle and error. No filters/blurs on the
 *  image itself -- a plain flat-colour overlay div is the entire treatment,
 *  cheap on 488MB. */
function ModelTile({
  button,
  loaded,
  loading,
  pending,
  errorId,
  disabled,
  optimisticId,
  onTap,
}: {
  button: ButtonConfig
  loaded: string | null
  loading: string | null
  pending: string | null
  errorId: string | null
  disabled: boolean
  optimisticId: string | null
  onTap: (button: ButtonConfig) => void
}) {
  const isLoaded = button.expectedModel !== undefined && loaded === button.expectedModel
  const realLoading = button.expectedModel !== undefined && loading === button.expectedModel
  // Optimism only fills the gap BEFORE real state has an opinion -- once
  // either realLoading or isLoaded is true, this is false on the very same
  // render (no dependency on the cleanup effect having run yet), so the
  // loading->loaded handover can never show a stale blue frame.
  const isOptimistic = optimisticId === button.id && !realLoading && !isLoaded
  const isLoading = realLoading || isOptimistic
  const { tone, tappable } = resolveModelTile({
    isPending: pending === button.id,
    isError: errorId === button.id,
    isLoading,
    isLoaded,
    disabled,
  })
  const style = TONE_STYLE[tone]
  const art = tone === 'loading' || tone === 'loaded' ? button.icons.active : button.icons.inactive
  return (
    <TileFrame
      tappable={tappable}
      borderClass={`${borderWidthClass(tone)} ${style.border}`}
      scrimAlpha={style.scrimAlpha}
      art={art}
      onClick={() => {
        if (tappable) onTap(button)
      }}
    >
      <div className={`truncate font-semibold ${style.label}`} style={{ ...LABEL_SHADOW, fontSize: 12, lineHeight: 1.15 }}>
        {button.displayName}
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
    </TileFrame>
  )
}

/** The grid's status line, not a 12th tile -- what "the loaded tile lights
 *  up" doesn't convey: the state you're actually in when nothing is
 *  loaded. Same tone vocabulary as everywhere else: red only for an
 *  actual failure (router unreachable), neutral for the normal IDLE state.
 *  The small router icon is a non-full-bleed prefix mark, not a tile. */
function RouterStatusLine({
  available,
  loaded,
  count,
  error,
}: {
  available: boolean
  loaded: string | null
  count: number | null
  error?: string
}) {
  if (!available) {
    return (
      <div className="flex shrink-0 items-center justify-between border-b border-stone-800 px-2 py-1 text-[11px]">
        <span className="flex items-center">
          <img src={iconUrl('icon_router_off.png')} alt="" className="mr-1 h-[14px] w-[14px]" />
          <span className="font-semibold uppercase tracking-wide text-red-400">router unreachable</span>
        </span>
        <span className="truncate text-stone-500">{error ?? 'unknown error'}</span>
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-stone-800 px-2 py-1 text-[11px]">
      <span className="flex items-center">
        <img src={iconUrl(loaded ? 'icon_router_active.png' : 'icon_router_off.png')} alt="" className="mr-1 h-[14px] w-[14px]" />
        <span className="font-semibold uppercase tracking-wide text-stone-300">
          router: <span className={loaded ? 'text-emerald-300' : 'text-stone-500'}>{loaded ?? 'IDLE'}</span>
        </span>
      </span>
      <span className="tabular-nums text-stone-500">{count} models</span>
    </div>
  )
}

/**
 * Owner, verbatim: "if I am seeing router stop doesn't it mean its
 * running?" -- stacking a plain identity word over a plain verb reads as
 * either "the state IS X" or "tap to do X"; it fails at a glance. Fix: the
 * STATE is a distinct bold word colour-coded by the tone vocabulary, and
 * the ACTION is a separate glyph+word rendered as a small filled pill -- a
 * shape nothing else on the tile has, so it can only read as "tap this".
 */
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

/** `kind: "action"` -- fires `button.argv` once (KILL today; the config
 *  allows more). No expectedModel, so no loaded/loading tone -- but it
 *  reuses the SAME resolveModelTile decision as the model tiles for
 *  eligibility, folding `requiresLoadedModel` into `disabled` rather than
 *  a parallel branch: router-down and nothing-to-unload both collapse to
 *  the one "inert" outcome that function already knows how to render. */
function ActionTile({
  button,
  pending,
  errorId,
  disabled,
  loaded,
  onTap,
}: {
  button: ButtonConfig
  pending: string | null
  errorId: string | null
  disabled: boolean
  loaded: string | null
  onTap: (button: ButtonConfig) => void
}) {
  const effectiveDisabled = disabled || (button.requiresLoadedModel === true && !loaded)
  const { tone, tappable } = resolveModelTile({
    isPending: pending === button.id,
    isError: errorId === button.id,
    isLoading: false,
    isLoaded: false,
    disabled: effectiveDisabled,
  })
  const style = TONE_STYLE[tone]
  return (
    <TileFrame
      tappable={tappable}
      borderClass={`${borderWidthClass(tone)} ${style.border}`}
      scrimAlpha={tappable ? style.scrimAlpha : 0.82}
      art={tone === 'confirm' ? button.icons.active : button.icons.inactive}
      onClick={() => {
        if (tappable) onTap(button)
      }}
    >
      <div className={`text-lg font-bold tracking-widest ${tappable ? style.label : 'text-stone-600'}`} style={LABEL_SHADOW}>
        {button.displayName}
      </div>
      {tone === 'confirm' ? (
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-300" style={LABEL_SHADOW}>
          CONFIRM?
        </div>
      ) : tone === 'error' ? (
        <div className="text-[10px] font-bold uppercase tracking-wide text-red-300" style={LABEL_SHADOW}>
          FAILED
        </div>
      ) : !tappable ? (
        <div className="mt-0.5 inline-block rounded-sm bg-stone-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-stone-500">
          {button.subLabel ?? ''}
        </div>
      ) : (
        <ActionPill label={button.subLabel ?? 'go'} tone="stop" />
      )}
    </TileFrame>
  )
}

/** `kind: "toggle"` -- ROUTER today. NEVER disabled by router-down, since
 *  it's the recovery action for exactly that state. STATE (RUNNING/
 *  STOPPED) and ACTION (the pill) are driven purely off `available` --
 *  no local state that could disagree with the service. */
function ToggleTile({
  button,
  available,
  pending,
  errorId,
  onTap,
}: {
  button: ButtonConfig
  available: boolean
  pending: string | null
  errorId: string | null
  onTap: (button: ButtonConfig) => void
}) {
  const isPending = pending === button.id
  const isError = errorId === button.id
  const border = isPending ? 'border-amber-400' : isError ? 'border-red-500' : available ? 'border-emerald-500' : 'border-stone-800'
  const scrimAlpha = isPending || isError || available ? 0.45 : 0.68
  return (
    <TileFrame
      tappable
      borderClass={`${isPending || isError || available ? 'border-l-2 border-t-2' : 'border-l border-t'} ${border}`}
      scrimAlpha={scrimAlpha}
      art={available ? button.icons.active : button.icons.inactive}
      onClick={() => onTap(button)}
    >
      <div className="text-[9px] uppercase tracking-widest text-stone-400" style={LABEL_SHADOW}>
        {button.displayName}
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
    </TileFrame>
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

/** Slot 4 -- the CONTROL grid, entirely config-driven from GET /config
 *  (services/deviceinfo/buttons.json). Array order IS grid order. Five-tone
 *  vocabulary throughout: idle (gray) / loading (blue, router-driven) /
 *  loaded (green) / error (red, transient) / confirm (amber, local
 *  tap-arm) -- see TONE_STYLE above. */
export function ControlSlot({ info, reachable }: Props) {
  const fetchedButtons = useButtonsConfig()
  // Demo swaps the CONFIG SOURCE, exactly like the other data sources -- the
  // grid below renders demo buttons through the identical ButtonConfig path.
  const buttons = isDemoActive() ? DEMO_BUTTONS : fetchedButtons
  const { errorId, flash } = useTransientError()
  const { pending, tap, cancel } = useConfirm()
  const { optimistic, start: startOptimistic, clear: clearOptimistic } = useOptimisticLoad()

  // Hand-over: once real state acknowledges the local guess (loading OR
  // loaded now matches), disarm the giveup timer. Purely a cleanup concern
  // -- ModelTile's render-time guard already self-corrects every frame
  // regardless of whether this effect has run yet, so there is no visual
  // dependency on its timing (see the comment there).
  const routerLoading = info?.fleet.router.loading ?? null
  const routerLoaded = info?.fleet.router.loaded ?? null
  useEffect(() => {
    if (!optimistic) return
    if (routerLoading === optimistic.expectedModel || routerLoaded === optimistic.expectedModel) clearOptimistic()
  }, [routerLoading, routerLoaded, optimistic?.expectedModel])

  if (!reachable || !info) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-stone-400">CONTROL</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">deviceinfo service unreachable</div>
      </div>
    )
  }
  if (!buttons) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-stone-400">CONTROL</div>
        <div className="mt-1 text-xs uppercase tracking-widest text-stone-600">button config unavailable</div>
      </div>
    )
  }

  const { loaded, loading, available, count, error } = info.fleet.router
  const gridDisabled = !available
  // Purely cosmetic grid-line symmetry -- generic over however many
  // buttons the config carries, not a fixed "10 models + 2" assumption.
  const fillerCount = buttons.length > 0 ? (4 - (buttons.length % 4)) % 4 : 0

  // Optimistic-on-start, authoritative-on-end: the confirming tap is a fact
  // we already know locally with zero uncertainty, so a `kind: "model"`
  // tile goes blue/breathing THIS render, no round trip. It only ever
  // LEAVES that state because real router state says so (ModelTile's own
  // guard) or because OPTIMISTIC_GIVEUP_MS gave up -- never a fixed "it's
  // probably done by now" timer standing in for real state.
  const onTap = (button: ButtonConfig) => {
    const fires = button.confirm ? tap(button.id) : true
    if (!fires) return
    if (button.kind === 'model' && button.expectedModel) {
      startOptimistic(button.id, button.expectedModel, (id) => flash(id))
    }
    postAction(button.id, () => flash(button.id))
  }

  return (
    <div className="flex h-full flex-col">
      <RouterStatusLine available={available} loaded={loaded} count={count} error={error} />
      <div
        className="flex-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: '1fr' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) cancel()
        }}
      >
        {buttons.map((button) => {
          if (button.kind === 'toggle') {
            return <ToggleTile key={button.id} button={button} available={available} pending={pending} errorId={errorId} onTap={onTap} />
          }
          if (button.kind === 'action') {
            return (
              <ActionTile key={button.id} button={button} pending={pending} errorId={errorId} disabled={gridDisabled} loaded={loaded} onTap={onTap} />
            )
          }
          return (
            <ModelTile
              key={button.id}
              button={button}
              loaded={loaded}
              loading={loading}
              pending={pending}
              errorId={errorId}
              disabled={gridDisabled}
              optimisticId={optimistic?.id ?? null}
              onTap={onTap}
            />
          )
        })}
        {Array.from({ length: fillerCount }).map((_, i) => (
          <div key={`filler-${i}`} className="border-l border-t border-stone-800" />
        ))}
      </div>
      <DeviceInfoStrip device={info.device} />
    </div>
  )
}
