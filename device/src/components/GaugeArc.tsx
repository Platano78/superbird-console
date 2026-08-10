/**
 * Radial instrument-cluster gauge: a 270° arc built from stacked SVG circles
 * (banded scale + value), stroke-dasharray/dashoffset only — the one arc
 * primitive measured working on the device (Chromium 69). No `conic-gradient`
 * here on purpose: a filled sweep reads as a tachometer, a soft radial fade
 * reads as decoration.
 *
 * The redline is part of the SCALE, not a separate decoration: the track
 * itself is painted in three bands (neutral 0-75, amber 75-90, red 90-100)
 * and the value arc is drawn over that same path, in the tone matching where
 * its own tip lands — same 0.75/0.90 thresholds SessionGrid/UsageRail use.
 *
 * Angle convention: 0deg = 3 o'clock, increasing clockwise (SVG y-down).
 * The whole arc + its tick marks share one `rotate(135 50 50)` group so the
 * visual gap always sits centered at the bottom (start -225deg, end 45deg) —
 * a real cluster's needle never sweeps behind the housing.
 */

const R = 42
const CIRC = 2 * Math.PI * R
const SWEEP = 270
const ARC_LEN = (CIRC * SWEEP) / 360
const AMBER_FROM = 0.75
const RED_FROM = 0.9

export type GaugeTone = 'neutral' | 'amber' | 'red'

const TONE_STROKE: Record<GaugeTone, string> = {
  neutral: '#e7e5e4', // stone-200 — no fill/no reading is not a state to alarm over
  amber: '#fbbf24',
  red: '#f87171',
}
// Dim band paint under the value arc — the scale, always visible regardless of reading.
const BAND_STROKE: Record<GaugeTone, string> = {
  neutral: '#3f3c38',
  amber: '#78530f',
  red: '#7f1d1d',
}

type Props = {
  /** 0..1, or null when the daemon has no reading yet — draws an empty face. */
  value: number | null
  tone: GaugeTone
  size: number
}

function point(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) }
}

/** dasharray/offset for the [from, to) sub-arc of the scale, 0..1 fractions. */
function band(from: number, to: number) {
  return { dasharray: `${ARC_LEN * (to - from)} ${CIRC}`, offset: -ARC_LEN * from }
}

export function GaugeArc({ value, tone, size }: Props) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value))
  const valueLen = ARC_LEN * pct
  const neutralBand = band(0, AMBER_FROM)
  const amberBand = band(AMBER_FROM, RED_FROM)
  const redBand = band(RED_FROM, 1)
  // Scale anchors sit just outside the arc, in absolute (already-rotated) angles.
  const zero = point(135, 47)
  const hundred = point(45, 47)
  const fifty = point(270, 47)

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="block">
      <g transform="rotate(135 50 50)">
        <circle cx="50" cy="50" r={R} fill="none" stroke={BAND_STROKE.neutral} strokeWidth="7" strokeDasharray={neutralBand.dasharray} strokeDashoffset={neutralBand.offset} />
        <circle cx="50" cy="50" r={R} fill="none" stroke={BAND_STROKE.amber} strokeWidth="7" strokeDasharray={amberBand.dasharray} strokeDashoffset={amberBand.offset} />
        <circle cx="50" cy="50" r={R} fill="none" stroke={BAND_STROKE.red} strokeWidth="7" strokeDasharray={redBand.dasharray} strokeDashoffset={redBand.offset} />
        {/* value: the actual reading, painted in the tone its own tip lands
            in. Animating dasharray is the only motion here — it fires when
            the value moves, so movement means something. */}
        {value !== null && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={TONE_STROKE[tone]}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${valueLen} ${CIRC}`}
            style={{ transition: 'stroke-dasharray 700ms ease-out' }}
          />
        )}
        {/* tick marks across the sweep */}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (SWEEP / 7) * i
          const a = point(angle, 36)
          const b = point(angle, 41)
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#78716c" strokeWidth="1.5" />
        })}
      </g>
      {/* scale anchors — outside the rotated group, angles already absolute */}
      <text x={zero.x} y={zero.y} fontSize="6" fill="#78716c" textAnchor="middle" dominantBaseline="middle">0</text>
      <text x={hundred.x} y={hundred.y} fontSize="6" fill="#78716c" textAnchor="middle" dominantBaseline="middle">100</text>
      <text x={fifty.x} y={fifty.y} fontSize="6" fill="#78716c" textAnchor="middle" dominantBaseline="middle">50</text>
    </svg>
  )
}
