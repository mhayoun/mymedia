// What the app is doing, as a list shown in the Activity window: each step of a
// load, the analysis, the compression and the background work, the messages
// shown, and the problems written to the console. Kept in memory only.

import { useApp } from './store'

export interface ActivityEntry {
  id: number
  at: number
  /** Set when the step is over; a running step has none. */
  end?: number
  /** i18n key and values; or `text` for a console message. */
  key?: string
  values?: Record<string, number | string>
  text?: string
  kind: 'info' | 'warn' | 'error'
}

const MAX = 300
let entries: ActivityEntry[] = []
let nextId = 1
const listeners = new Set<() => void>()

export function activity(): ActivityEntry[] {
  return entries
}

export function subscribeActivity(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function changed() {
  entries = [...entries]
  for (const cb of listeners) cb()
}

function add(e: Omit<ActivityEntry, 'id' | 'at'>): ActivityEntry {
  const entry = { ...e, id: nextId++, at: Date.now() }
  entries.push(entry)
  if (entries.length > MAX) entries.splice(0, entries.length - MAX)
  changed()
  return entry
}

function finish(entry: ActivityEntry | null) {
  if (!entry || entry.end) return
  entry.end = Date.now()
  changed()
}

/** One step followed through its progress: a new line when its key changes. */
function tracker() {
  let cur: ActivityEntry | null = null
  return (key: string | null, values?: Record<string, number | string>) => {
    if (cur && cur.key === key) {
      if (values) Object.assign(cur, { values })
      return changed()
    }
    finish(cur)
    cur = key ? add({ key, values, kind: 'info' }) : null
  }
}

let started = false
export function startActivityLog() {
  if (started) return
  started = true
  const sync = tracker()
  const working = tracker()
  const indexing = tracker()
  const compressing = tracker()
  useApp.subscribe((s, prev) => {
    if (s.sync !== prev.sync) {
      sync(s.sync?.step ?? null, s.sync ? { done: s.sync.done, total: s.sync.total } : undefined)
      if (!s.sync && prev.sync) add({ key: 'activity.loaded', kind: 'info' })
    }
    if (s.working !== prev.working) working(s.working)
    if (s.indexing !== prev.indexing) indexing(s.indexing ? 'classify.learning' : null, s.indexing ?? undefined)
    if (s.compressing !== prev.compressing)
      compressing(s.compressing ? 'compress.progress' : null, s.compressing ? { done: s.compressing.done + 1, total: s.compressing.total } : undefined)
    if (s.toast && s.toast !== prev.toast) {
      const { key, count, bytes, detail } = s.toast
      add({ key, values: { ...(count != null && { count }), ...(bytes != null && { saved: bytes }), detail: detail ?? '' }, kind: 'info' })
    }
    if (s.error && s.error !== prev.error) add({ key: s.error, kind: 'error' })
  })
  // The app's own warnings and errors ("[MyMedia] …").
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      if (typeof args[0] !== 'string' || !args[0].startsWith('[MyMedia]')) return
      const text = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a)))
        .join(' ')
        .replace(/^\[MyMedia\]\s*/, '')
      add({ text, kind: level })
    }
  }
  if (!navigator.onLine) add({ key: 'sync.offline', kind: 'warn' })
  window.addEventListener('offline', () => add({ key: 'sync.offline', kind: 'warn' }))
  window.addEventListener('online', () => add({ key: 'activity.online', kind: 'info' }))
}

function safeJson(a: unknown): string {
  try {
    return JSON.stringify(a) ?? String(a)
  } catch {
    return String(a)
  }
}
