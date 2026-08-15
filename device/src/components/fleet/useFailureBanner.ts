import { useState } from 'react'
import type { MbLastResult } from '../../deviceInfo'

/**
 * Feedback tier 3, on-screen half (Ruling 13): a failure is a persistent
 * banner the operator must DISMISS, never a line that scrolls away on the
 * next action. Dismissal is LOCAL-ONLY -- it must never write back to the
 * server's lastResult, so this is plain component state, not an action POST.
 *
 * ponytail: MbLastResult carries no timestamp (id/ok/ms/error only), so
 * "a newer result" is approximated by (id, ms, error) together rather than
 * a true instant -- two failures of the SAME leaf back-to-back will almost
 * always differ in `ms`, which is enough to re-arm without needing a
 * server-side timestamp field added to the frozen contract.
 *
 * `visible` is a pure derivation off the current lastResult -- no effect,
 * same discipline as useFireLatch: nothing needs to be cleared on a poll
 * tick, the dismissed key simply stops matching once a new failure lands.
 */
export function useFailureBanner(lastResult: MbLastResult) {
  const key = lastResult ? `${lastResult.id}|${lastResult.ms}|${lastResult.error ?? ''}` : null
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  const visible = !!lastResult && !lastResult.ok && key !== dismissedKey
  const dismiss = () => setDismissedKey(key)

  return { visible, dismiss }
}
