import { Check, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Revision } from '../drive/api'
import { useFormat } from '../i18n/format'
import type { Recovery } from '../lib/recover'
import { applyRecovery, checkVersion, metaVersions } from '../sync/recover'
import { Modal } from './Dialog'

/** How many versions are looked at, newest first (each is a download of mymedia.json). */
const MAX_CHECKED = 60
const KINDS = ['imported', 'species', 'description', 'group', 'people', 'origin', 'compression'] as const

interface Row {
  rev: Revision
  recovery?: Recovery
  photos?: number
  failed?: boolean
}

/** Looks through the versions Drive kept of mymedia.json for what the photos have lost, and brings it back. */
export function RecoverDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    ;(async () => {
      try {
        const { fileId, versions } = await metaVersions()
        const list: Row[] = versions.slice(0, MAX_CHECKED).map((rev) => ({ rev }))
        if (!alive.current) return
        setRows(list)
        setChecking(true)
        let best: { id: string; photos: number } | null = null
        for (let i = 0; i < list.length && alive.current; i++) {
          try {
            const recovery = await checkVersion(fileId, list[i].rev.id)
            list[i] = { ...list[i], recovery, photos: recovery.patches.size }
            if (recovery.patches.size > (best?.photos ?? 0)) best = { id: list[i].rev.id, photos: recovery.patches.size }
          } catch (e) {
            console.warn('[MyMedia] version not read', list[i].rev.id, e)
            list[i] = { ...list[i], failed: true }
          }
          if (!alive.current) return
          setRows([...list])
          if (best) setChosen((c) => c ?? best!.id)
        }
        if (best) setChosen(best.id)
      } catch (e) {
        if (alive.current) setError(t('errors.generic', { message: (e as Error).message }))
      } finally {
        if (alive.current) setChecking(false)
      }
    })()
    return () => {
      alive.current = false
    }
  }, [t])

  const selected = rows?.find((r) => r.rev.id === chosen)?.recovery
  const kindsOf = (r: Recovery) =>
    KINDS.filter((k) => r.counts[k] || (k === 'people' && r.counts.peopleManual)).map((k) => t(`recover.kind.${k}`, { count: r.counts[k] ?? r.counts.peopleManual ?? 0 }))

  async function apply() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      setDone(await applyRecovery(selected))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal wide title={t('recover.title')} onClose={() => !busy && onClose()}>
      <p className="hint">{t('recover.intro')}</p>
      {!rows && !error && (
        <p>
          <Loader2 size={16} className="spin" /> {t('recover.listing')}
        </p>
      )}
      {rows && !rows.length && <p>{t('recover.noVersions')}</p>}
      {rows && rows.length > 0 && (
        <ul className="compress-list">
          {rows.map((r) => (
            <li key={r.rev.id} className={r.photos ? '' : 'off'}>
              <label>
                <input type="radio" name="version" checked={chosen === r.rev.id} disabled={!r.photos || done !== null} onChange={() => setChosen(r.rev.id)} />
                <span className="name">{fmt.dateTime(r.rev.modifiedTime)}</span>
              </label>
              <span className="sizes">
                {r.failed
                  ? t('compress.failed')
                  : r.photos === undefined
                    ? checking && <Loader2 size={14} className="spin" />
                    : r.photos
                      ? t('recover.photos', { count: r.photos })
                      : t('recover.nothing')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {selected && done === null && (
        <p>
          <strong>{t('recover.selected', { count: selected.patches.size })}</strong>
          <br />
          {kindsOf(selected).join(' · ')}
        </p>
      )}
      {rows && rows.length > 0 && !checking && !rows.some((r) => r.photos) && <p>{t('recover.allThere')}</p>}
      {done !== null && (
        <p className="ok-text">
          <Check size={16} /> {t('recover.done', { count: done })}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>
          {done !== null ? t('common.close') : t('common.cancel')}
        </button>
        {done === null && (
          <button className="btn primary" onClick={() => void apply()} disabled={!selected || busy}>
            {busy && <Loader2 size={16} className="spin" />} {t('recover.apply')}
          </button>
        )}
      </div>
    </Modal>
  )
}
