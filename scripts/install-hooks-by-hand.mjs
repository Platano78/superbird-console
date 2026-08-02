/**
 * Add claude-thing's hooks to ~/.claude/settings.json BY HAND.
 *
 * Upstream ships scripts/install-hooks.js — we must NOT run it (project law:
 * this box has a hand-tuned hook config). This reimplements only the additive
 * part: append one http hook per event, preserving every existing entry, and
 * refuse to run if anything would be lost.
 *
 * PermissionRequest timeout (40s) must exceed the daemon's hold (30s), or
 * Claude Code gives up first and the device answers into a closed connection.
 */
import fs from 'node:fs'

const SETTINGS = '/home/youruser/.claude/settings.json'
const URL = 'http://127.0.0.1:8790/hook'
const EVENTS = {
  PermissionRequest: 40,
  SessionStart: 5,
  SessionEnd: 3,
  UserPromptSubmit: 5,
  PreToolUse: 5,
  PostToolUse: 5,
  Stop: 5,
}

const before = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
const counts = (s) =>
  Object.fromEntries(Object.entries(s.hooks || {}).map(([k, v]) => [k, v.length]))
const pre = counts(before)

const backup = `${SETTINGS}.pre-claude-thing-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.copyFileSync(SETTINGS, backup)

const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
s.hooks = s.hooks || {}
for (const [event, timeout] of Object.entries(EVENTS)) {
  const list = (s.hooks[event] = s.hooks[event] || [])
  // idempotent: drop any prior claude-thing entry before appending
  const kept = list.filter((e) => !JSON.stringify(e).includes(':8790/hook'))
  kept.push({ matcher: '*', hooks: [{ type: 'http', url: URL, timeout }] })
  s.hooks[event] = kept
}

// Refuse to write if any pre-existing entry vanished.
const post = counts(s)
const lost = Object.entries(pre).filter(([k, n]) => (post[k] ?? 0) < n)
if (lost.length) {
  console.error('ABORT — would lose entries:', lost)
  process.exit(1)
}

fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2))
console.log('backup:', backup)
for (const k of Object.keys(post)) console.log(`${k}: ${pre[k] ?? 0} -> ${post[k]}`)
