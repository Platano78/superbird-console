/**
 * Shapes of the claude-thing daemon protocol.
 *
 * Verified against a live daemon 2026-08-01 (captured frames, not transcribed)
 * — see ../../docs/claude-protocol.md. Client half imports these type-only.
 */

export type SessionState = 'busy' | 'attention' | 'celebrate' | 'idle'

export type SessionSummary = {
  id: string
  name: string
  state: SessionState
  lastActivityTs: number
  tokens: { in: number; out: number }
  context: number | null
  pendingPermission: boolean
  /** undocumented upstream; observed 'default' | 'plan' | 'bypassPermissions' | null */
  permissionMode: string | null
  ended: boolean
}

export type Snapshot = {
  sessions: SessionSummary[]
  stats: { active: number; attention: number }
  /** Device clock is wrong in both axes (no RTC, no NTP) — render against these. */
  serverNowMs: number
  tzOffsetMin: number
}

export type AskOption = { label: string; description?: string }

/**
 * `claude.queue.list` merges TWO sources — permissions from the permission
 * bridge and questions from the queue — into one array. They are NOT
 * interchangeable: a permission is answered with `claude.permission.answer`
 * {requestId, decision}, a question with `claude.question.answer`
 * {id, optionIndex}. Sending the wrong one silently does nothing, because
 * permission-bridge finish() just returns false for an unknown id.
 * Always branch on `kind`.
 */
export type Ask = {
  kind: 'permission' | 'question'
  id: string
  sessionId: string
  sessionName: string
  createdTs: number

  // -- permission only (permission-bridge.js list()) --
  tool?: string
  summary?: string
  /**
   * ~595_000. NOT 55_000 — that figure in upstream's own doc is stale.
   * OPTIONAL: questions carry no timeout at all (queue.js onQuestion never sets
   * one — they live until the terminal prompt goes away). Treating it as
   * required rendered a NaN:NaN countdown on the device.
   */
  timeoutMs?: number

  // -- question only (queue.js onQuestion) --
  /** short label, already uppercased by the daemon */
  header?: string
  /** the actual question text — NOT `summary`, which questions never carry */
  question?: string
  options?: AskOption[]
  multiSelect?: boolean
}

/** What the app server pushes to the device client. */
export type ClientState = {
  connected: boolean
  snapshot: Snapshot | null
  asks: Ask[]
}
