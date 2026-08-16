import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { ComposeState } from '../../deviceInfo'
import { fireAction } from './shared'

/**
 * COMPOSE (Phase D) -- launch an operator-chosen combination of models on the
 * primary host, outside the fixed leaf roster.
 *
 * Touch-driven: rows toggle in and out of the selection, verbs sit on a fixed
 * bottom row. Ruling 9 (touch parity) already requires every page to work
 * without the dial, so touch-only is a legitimate first state.
 * ponytail: dial/cursor nav is NOT wired here -- itemCountFor still returns 0
 * for 'compose' so the cursor cannot land on it. Upgrade path is a cursor slot
 * per row plus the three verbs, same shape as LeavesPage.
 *
 * Ports are assigned, not chosen (a dial cannot enter one); the service
 * re-validates every port, key and ctx against the host's own roster before it
 * spawns anything. This page never pre-judges a refusal -- it sends the
 * selection and renders the launcher's verdict, including WHICH kind it was:
 * refused (nothing started) and gate-failure (started, never came up) are
 * different facts and are coloured differently.
 */
const PORTS = [8081, 8082, 8083, 8080]
const ROW: CSSProperties = { display: 'flex', alignItems: 'center', height: 34, paddingLeft: 8, paddingRight: 8, borderBottom: '1px solid #1c1917' }
const VERB: CSSProperties = { flex: 1, marginLeft: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, letterSpacing: 1 }

export function ComposePage({ compose }: { compose: ComposeState | undefined }) {
  const [selected, setSelected] = useState<string[]>([])

  const notice = !compose || !compose.configured
    ? ['NOT CONFIGURED', 'set MB_HOST and MB_SSH_HOST to enable']
    : !compose.roster
      ? ['NO ROSTER', compose.rosterError || 'host roster not loaded']
      : null
  if (notice) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px solid #292524', borderRadius: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: '#57534e' }}>COMPOSE</div>
        <div style={{ marginTop: 6, padding: '1px 6px', borderRadius: 3, background: '#292524', fontSize: 10, fontWeight: 600, letterSpacing: 2, color: '#78716c' }}>{notice[0]}</div>
        <div style={{ marginTop: 10, fontSize: 12, color: '#57534e' }}>{notice[1]}</div>
      </div>
    )
  }

  const roster = compose!.roster!
  const last = compose!.lastResult
  const selection = selected.map((key, i) => {
    const m = roster.filter((r) => r.key === key)[0]
    return { port: PORTS[i], key, ctx: m ? m.default_ctx : 0 }
  })
  const send = (id: string) => fireAction(id, selection.length ? { selection } : undefined)
  const toggle = (key: string) =>
    setSelected((cur) => (cur.indexOf(key) >= 0 ? cur.filter((k) => k !== key) : cur.concat([key]).slice(0, PORTS.length)))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {roster.map((m) => {
          const idx = selected.indexOf(m.key)
          const on = idx >= 0
          return (
            <div key={m.key} onClick={() => m.present && toggle(m.key)} style={{ ...ROW, opacity: m.present ? 1 : 0.35, background: on ? '#0c2a22' : 'transparent' }}>
              <span style={{ width: 46, fontSize: 11, fontWeight: 700, color: on ? '#34d399' : '#57534e' }}>{on ? `:${PORTS[idx]}` : m.present ? '' : 'ABSENT'}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: on ? '#e7e5e4' : '#a8a29e' }}>{m.key}</span>
              <span style={{ width: 62, fontSize: 10, color: '#78716c', textTransform: 'uppercase' }}>{m.class}</span>
              <span style={{ width: 58, fontSize: 10, color: '#78716c', textAlign: 'right' }}>{Math.round(m.default_ctx / 1024)}K</span>
            </div>
          )
        })}
      </div>
      {last && (
        <div style={{ padding: '3px 8px', fontSize: 10, borderTop: '1px solid #1c1917', color: last.kind === 'ok' ? '#34d399' : last.kind === 'refused' ? '#fbbf24' : '#f87171' }}>
          <b>{last.verb.toUpperCase()} {last.kind.toUpperCase()}</b> — {last.detail}{last.recovery ? ` · recover: ${last.recovery}` : ''}
        </div>
      )}
      <div style={{ display: 'flex', height: 44, borderTop: '1px solid #292524' }}>
        {([
          [`DRYRUN${selection.length ? ` (${selection.length})` : ''}`, selection.length > 0, 'mb.compose.dryrun', '#d6d3d1'],
          ['LAUNCH', selection.length > 0, 'mb.compose.launch', '#fca5a5'],
          ['STOP', true, 'mb.compose.stop', '#d6d3d1'],
        ] as [string, boolean, string, string][]).map(([label, on, id, tone]) => (
          <div key={id} onClick={() => on && send(id)} style={{ ...VERB, color: on ? tone : '#44403c', background: on ? '#1c1917' : '#0c0a09' }}>{label}</div>
        ))}
      </div>
    </div>
  )
}
