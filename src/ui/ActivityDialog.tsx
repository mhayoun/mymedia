import { CircleAlert, Copy, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { activity, subscribeActivity, type ActivityEntry } from '../activity'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { syncNow } from '../sync/engine'
import { Modal } from './Dialog'
import { useOnline } from './hooks'

/** What the app is doing and has done since it was opened, newest first. */
export function ActivityDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const entries = useSyncExternalStore(subscribeActivity, activity)
  const syncing = useApp((s) => !!s.sync)
  const online = useOnline()
  const [copied, setCopied] = useState(false)

  const clock = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const label = (e: ActivityEntry) => {
    if (e.text) return e.text
    const values = Object.fromEntries(Object.entries(e.values ?? {}).map(([k, v]) => [k, k === 'saved' && typeof v === 'number' ? fmt.bytes(v) : typeof v === 'number' && k !== 'count' ? fmt.number(v) : v]))
    return t(e.key!, values)
  }
  const line = (e: ActivityEntry) =>
    `${clock(e.at)}${e.end ? ` (${fmt.duration(e.end - e.at)})` : ''}  ${e.kind === 'info' ? '' : `${e.kind.toUpperCase()} `}${label(e)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entries.map(line).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused (not focused, old browser): nothing to do.
    }
  }

  return (
    <Modal wide title={t('activity.title')} onClose={onClose}>
      <ol className="activity-list">
        {entries.length === 0 && <li className="hint">{t('activity.empty')}</li>}
        {[...entries].reverse().map((e) => (
          <li key={e.id} className={e.kind}>
            <span className="time">{clock(e.at)}</span>
            <span className="icon">
              {e.kind === 'error' ? <CircleAlert size={14} /> : e.kind === 'warn' ? <TriangleAlert size={14} /> : !e.end && e.key && !e.key.startsWith('activity.') ? <Loader2 size={14} className="spin" /> : null}
            </span>
            <span className="what" dir="auto">
              {label(e)}
              {e.end && e.end - e.at >= 1000 && <span className="hint"> · {fmt.duration(e.end - e.at)}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button className="btn ghost" onClick={() => void copy()} disabled={!entries.length}>
          <Copy size={16} /> {t(copied ? 'activity.copied' : 'activity.copy')}
        </button>
        <button className="btn" onClick={() => void syncNow()} disabled={syncing || !online}>
          <RefreshCw size={16} className={syncing ? 'spin' : undefined} /> {t('gallery.loadNew')}
        </button>
        <button className="btn primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}
