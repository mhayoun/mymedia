import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { findKatiaData, runKatiaImport, type KatiaSource } from '../import/katia'
import { Modal } from './Dialog'

/** "Bring in the data of Katia": species, dates, texts; one album per species. */
export function KatiaDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'search' | 'show' | 'run' | 'done' | 'error'>('search')
  const [sources, setSources] = useState<KatiaSource[]>([])
  const [trashEmptied, setTrashEmptied] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [count, setCount] = useState(0)

  useEffect(() => {
    findKatiaData()
      .then((s) => {
        setSources(s)
        setPhase('show')
      })
      .catch((e) => {
        console.error('[MyMedia] Katia data not read', e)
        setPhase('error')
      })
  }, [])

  const ready = sources.find((s) => s.pending)
  const outside = sources.filter((s) => !s.inside)
  const plan = ready?.plan

  async function start() {
    if (!ready) return
    setPhase('run')
    try {
      setCount(await runKatiaImport(ready, { trashEmptied }, (done, total) => setProgress({ done, total })))
      setPhase('done')
    } catch (e) {
      console.error('[MyMedia] Katia import failed', e)
      setPhase('error')
    }
  }

  return (
    <Modal title={t('katia.title')} onClose={phase === 'run' ? () => undefined : onClose}>
      {phase === 'search' && (
        <p>
          <Loader2 size={16} className="spin" /> {t('katia.searching')}
        </p>
      )}
      {phase === 'error' && <p className="error-text">{t('katia.error')}</p>}

      {phase === 'show' && !ready && (
        <>
          {outside.length > 0 ? (
            outside.map((s) => (
              <p key={s.folderId}>{t('katia.moveFirst', { name: s.folderName })}</p>
            ))
          ) : (
            <p>{sources.length ? t('katia.nothingToDo') : t('katia.notFound')}</p>
          )}
        </>
      )}

      {phase === 'show' && ready && plan && (
        <>
          <p>{t('katia.found', { name: ready.folderName, count: ready.entries })}</p>
          <ul>
            {plan.species.size > 0 && (
              <li>{t('katia.toSpecies', { count: [...plan.species.values()].reduce((a, b) => a + b, 0), albums: plan.species.size })}</li>
            )}
            {plan.toReview > 0 && <li>{t('katia.toReview', { count: plan.toReview })}</li>}
            {plan.dates > 0 && <li>{t('katia.dates', { count: plan.dates })}</li>}
            {plan.descriptions > 0 && <li>{t('katia.descriptions', { count: plan.descriptions })}</li>}
            {plan.unmatched > 0 && <li className="hint">{t('katia.unmatched', { count: plan.unmatched })}</li>}
          </ul>
          {plan.species.size > 0 && (
            <div className="chip-list">
              {[...plan.species.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <span key={name} className="chip-btn">
                    <bdi>{name}</bdi> · {n}
                  </span>
                ))}
            </div>
          )}
          {plan.emptied.length > 0 && (
            <label className="radio-row">
              <input type="checkbox" checked={trashEmptied} onChange={(e) => setTrashEmptied(e.target.checked)} />
              {t('katia.trashEmptied', { count: plan.emptied.length })}
            </label>
          )}
          <p className="hint">{t('katia.safe')}</p>
        </>
      )}

      {phase === 'run' && (
        <>
          <p>{t('katia.running', progress)}</p>
          <progress max={progress.total || 1} value={progress.done} style={{ inlineSize: '100%' }} />
        </>
      )}
      {phase === 'done' && <p>{t('katia.done', { count })}</p>}

      <div className="actions">
        {phase === 'show' && ready ? (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" onClick={start}>
              {t('katia.start')}
            </button>
          </>
        ) : (
          phase !== 'run' && (
            <button className="btn primary" onClick={onClose}>
              {t('common.ok')}
            </button>
          )
        )}
      </div>
    </Modal>
  )
}
