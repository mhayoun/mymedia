import { Loader2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { useFormat } from '../i18n/format'
import { ALBUM_SEPARATOR } from '../lib/tree'
import { findStranded, groupStranded, reclaim, type Stranded } from '../transfer/reclaim'
import { Modal } from './Dialog'
import { useAuthStatus } from './hooks'

type Busy = { done: number; total: number } | null

/** Google's access lasts one hour; at most this long is asked for before a long run. */
const HOUR_MS = 60 * 60_000

/** Renews Google's access now if it would end during a run of `count` photos (call it from a click). */
export function renewForReclaim(count: number) {
  auth.renewBefore(Math.min(HOUR_MS - 5 * 60_000, Math.max(5 * 60_000, count * 400)))
}

/**
 * Lists the photos given but never accepted, then puts them back in this
 * MyMedia; with `direct`, takes them back as soon as they are found.
 */
export function ReclaimDialog({ onClose, direct }: { onClose: () => void; direct?: boolean }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const authStatus = useAuthStatus()
  const [list, setList] = useState<Stranded[] | null>(null)
  const [busy, setBusy] = useState<Busy>({ done: 0, total: 0 })
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = useMemo(() => (list ? groupStranded(list) : []), [list])

  useEffect(() => {
    findStranded((done, total) => setBusy({ done, total }))
      .then((found) => {
        setList(found)
        if (direct && found.length) void run(found)
        else setBusy(null)
      })
      .catch((e) => {
        console.error('[MyMedia] reclaim scan failed', e)
        setError(t('errors.generic', { message: (e as Error).message }))
        setBusy(null)
      })
    // Once, when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (list: Stranded[]) => {
    setError(null)
    setBusy({ done: 0, total: list.length })
    try {
      const r = await reclaim(list, (done, total) => setBusy({ done, total }))
      setResult(r.failed ? t('reclaim.partly', { failed: r.failed, total: list.length, reason: r.reason ?? '?' }) : t('reclaim.done', { count: list.length }))
      setList([])
    } catch (e) {
      console.error('[MyMedia] reclaim failed', e)
      setError(t('errors.generic', { message: (e as Error).message }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal wide closeButton title={t('reclaim.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        <p className="hint">{t('reclaim.hint')}</p>
        {busy && authStatus === 'needsReconnect' && (
          <div className="error-text">
            <p>{t('reclaim.reconnect')}</p>
            <button type="button" className="btn primary" onClick={() => auth.signIn()}>
              {t('auth.reconnect')}
            </button>
          </div>
        )}
        {busy && (
          <p>
            <Loader2 size={14} className="spin" />{' '}
            {list === null ? t('reclaim.searching') : ''}{' '}
            {busy.total > 0 && t('select.working', { done: fmt.number(busy.done), total: fmt.number(busy.total) })}
          </p>
        )}
        {list && !result && (list.length === 0 ? (
          <p>{t('reclaim.none')}</p>
        ) : (
          <>
            <p>
              <strong>{t('reclaim.found', { count: list.length })}</strong>
            </p>
            <ul>
              {groups.map((g) => (
                <li key={g.path.join(ALBUM_SEPARATOR)}>
                  <bdi>{g.path.length ? g.path.join(ALBUM_SEPARATOR) : t('reclaim.rootFolder')}</bdi> — {fmt.number(g.count)}
                </li>
              ))}
            </ul>
            <p className="hint">{t('reclaim.warning')}</p>
          </>
        ))}
        {result && <p className="ok-text">{result}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled={!!busy} onClick={onClose}>
          {t('common.close')}
        </button>
        {!!list?.length && (
          <button
            type="button"
            className="btn primary"
            disabled={!!busy}
            onClick={() => {
              renewForReclaim(list.length)
              void run(list)
            }}
          >
            <Undo2 size={16} /> {t('reclaim.confirm', { count: list.length })}
          </button>
        )}
      </div>
    </Modal>
  )
}
