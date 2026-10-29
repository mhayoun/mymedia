import { CalendarClock, Loader2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import { changedDate, type DateChange } from '../lib/dates'
import { DATE_SET_KEY } from '../lib/media'
import { changeDate, datesChanged, resetDate } from '../sync/dates'
import { Modal } from './Dialog'

/** Changes the date of one or more photos (MyMedia Pro): one date for all, or a shift; or back to their own date. */
export function DateDialog({ recs, onClose, onDone }: { recs: MediaRecord[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const first = recs[0]
  const [kind, setKind] = useState<'set' | 'shift'>('set')
  const [date, setDate] = useState(first?.takenAt.slice(0, 10) ?? '')
  const [time, setTime] = useState(recs.length === 1 ? (first?.takenAt.slice(11, 16) ?? '') : '')
  const [shift, setShift] = useState({ years: '0', days: '0', hours: '0', minutes: '0' })
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const n = (s: string) => (/^[+-]?\d+$/.test(s.trim()) ? Number(s) : NaN)
  const shiftValues = { years: n(shift.years), days: n(shift.days), hours: n(shift.hours), minutes: n(shift.minutes) }
  const change: DateChange | null =
    kind === 'set'
      ? { kind: 'set', date, time: time || null }
      : Object.values(shiftValues).every(Number.isFinite) && Object.values(shiftValues).some(Boolean)
        ? { kind: 'shift', ...shiftValues }
        : null
  const example = first && change ? changedDate(first.takenAt, change) : null
  const changed = recs.filter((r) => r.appProperties?.[DATE_SET_KEY])

  /** Runs `fn` on each photo, with progress; the failures are counted. */
  const run = async (fn: (r: MediaRecord) => Promise<unknown>, list = recs) => {
    setError(null)
    let failed = 0
    setBusy({ done: 0, total: list.length })
    for (const [k, r] of list.entries()) {
      try {
        if ((await fn(r)) === false) failed++
      } catch (e) {
        console.error('[MyMedia] date not changed', r.name, e)
        failed++
      }
      setBusy({ done: k + 1, total: list.length })
    }
    await datesChanged()
    setBusy(null)
    if (failed) return setError(t('dates.failed', { count: failed }))
    onDone()
  }

  return (
    <Modal title={t('dates.changeTitle', { count: recs.length })} onClose={() => !busy && onClose()}>
      <div className="field">
        <label>
          <input type="radio" checked={kind === 'set'} onChange={() => setKind('set')} disabled={!!busy} /> {t('dates.set')}
        </label>
        <label>
          <input type="radio" checked={kind === 'shift'} onChange={() => setKind('shift')} disabled={!!busy} /> {t('dates.shift')}
        </label>
      </div>

      {kind === 'set' ? (
        <div className="row">
          <label className="field">
            {t('dates.day')}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!busy} />
          </label>
          <label className="field">
            {t('dates.time')}
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!!busy} />
          </label>
        </div>
      ) : (
        <>
          <p className="hint">{t('dates.shiftHint')}</p>
          <div className="row">
            {(['years', 'days', 'hours', 'minutes'] as const).map((k) => (
              <label key={k} className="field date-shift">
                {t(`dates.${k}`)}
                <input
                  type="number"
                  inputMode="numeric"
                  dir="ltr"
                  value={shift[k]}
                  onChange={(e) => setShift({ ...shift, [k]: e.target.value })}
                  disabled={!!busy}
                />
              </label>
            ))}
          </div>
        </>
      )}
      {kind === 'set' && recs.length > 1 && !time && <p className="hint">{t('dates.keepTime')}</p>}
      {first && example && (
        <p className="hint">
          {t('dates.example', { before: fmt.dateTime(first.takenAt), after: fmt.dateTime(example), arrow: fmt.arrow })}
        </p>
      )}
      <p className="hint">{t('dates.where')}</p>
      {busy && (
        <p className="hint">
          <Loader2 size={14} className="spin" /> {t('select.working', busy)}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      <div className="actions">
        {changed.length > 0 && (
          <button className="btn" disabled={!!busy} onClick={() => void run((r) => resetDate(r.id), changed)}>
            <Undo2 size={16} /> {t('dates.reset', { count: changed.length })}
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={!!busy}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" disabled={!!busy || !example} onClick={() => change && void run((r) => changeDate(r.id, change))}>
          <CalendarClock size={16} /> {t('dates.apply')}
        </button>
      </div>
    </Modal>
  )
}
