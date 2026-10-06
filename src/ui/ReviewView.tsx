import { Check, Home, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { acceptConfident, chooseFolder, classifyPending, confirmAuto, keepHere } from '../classify/engine'
import { useFormat } from '../i18n/format'
import { placementOf } from '../lib/tree'
import { app, useApp } from '../store'
import { AlbumSelect } from './AlbumSelect'
import { Thumb } from './Thumb'
import type { Library, LibraryItem } from './useLibrary'
import { Viewer } from './Viewer'

const PAGE = 60

interface Props {
  lib: Library
  items: LibraryItem[]
  mode: 'classify' | 'auto'
}

/** "To classify" (suggestions to confirm) and "Auto" (automatic moves to review). */
export function ReviewView({ lib, items, mode }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const medium = useApp((s) => s.settings.thresholdMedium)
  const viewerId = useApp((s) => s.viewerId)
  const set = useApp((s) => s.set)
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const label = (folderId: string) => {
    const p = placementOf(folderId, lib.folders, rootId)
    return { short: p.album?.split(' / ').pop() ?? p.category ?? '', full: [p.category, p.album].filter(Boolean).join(' / ') }
  }

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(id))
    try {
      await fn()
    } catch (e) {
      console.error(e)
      app().set({ error: 'errors.syncFailed' })
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(id)
        return n
      })
    }
  }

  const confident = useMemo(
    () => items.filter((i) => (i.meta?.suggestions?.[0]?.confidence ?? 0) >= medium).map((i) => i.rec.id),
    [items, medium],
  )
  const ids = useMemo(() => items.map((i) => i.rec.id), [items])

  const bulk = async (fn: () => Promise<unknown>) => {
    setBulkBusy(true)
    try {
      await fn()
    } finally {
      setBulkBusy(false)
    }
  }

  return (
    <div className="gallery-scroll review">
      <div className="review-bar">
        {mode === 'classify' ? (
          <>
            <p className="hint">{t('classify.introClassify')}</p>
            <button className="btn primary" disabled={bulkBusy || !confident.length} onClick={() => bulk(() => acceptConfident(confident))}>
              <Check size={16} /> {t('classify.acceptAll', { count: confident.length, percent: fmt.percent(medium) })}
            </button>
            <button className="btn" disabled={bulkBusy} onClick={() => bulk(classifyPending)}>
              <Wand2 size={16} /> {t('classify.runNow')}
            </button>
          </>
        ) : (
          <>
            <p className="hint">{t('classify.introAuto')}</p>
            <button className="btn primary" disabled={bulkBusy || !ids.length} onClick={() => bulk(() => confirmAuto(ids))}>
              <Check size={16} /> {t('classify.allCorrect')}
            </button>
          </>
        )}
      </div>

      <div className="review-grid">
        {items.slice(0, shown).map(({ rec, meta, place }) => {
          const isBusy = busy.has(rec.id) || bulkBusy
          const sugg = meta?.suggestions ?? []
          return (
            <div className="review-card" key={rec.id} aria-busy={isBusy}>
              <Thumb rec={rec} onOpen={(id) => set({ viewerId: id })} />
              <div className="review-body">
                <div className="review-name" title={rec.name}>
                  <bdi>{meta?.description || rec.name}</bdi>
                </div>
                {mode === 'classify' ? (
                  <>
                    <div className="hint">
                      {t('classify.now')}: <bdi>{place.category ?? t('classify.root')}</bdi>
                      {meta?.toCheck && <span className="tag warn">{t('classify.toCheck')}</span>}
                    </div>
                    {sugg.length > 0 ? (
                      <>
                        <button
                          className="btn primary suggestion"
                          disabled={isBusy}
                          title={label(sugg[0].folderId).full}
                          onClick={() => act(rec.id, () => chooseFolder(rec.id, sugg[0].folderId))}
                        >
                          <Check size={16} />
                          <bdi>{label(sugg[0].folderId).short}</bdi>
                          <span className="pct">{fmt.percent(sugg[0].confidence)}</span>
                        </button>
                        <div className="chips">
                          {sugg.slice(1).map((s) => (
                            <button
                              key={s.folderId}
                              className="chip-btn"
                              disabled={isBusy}
                              title={label(s.folderId).full}
                              onClick={() => act(rec.id, () => chooseFolder(rec.id, s.folderId))}
                            >
                              <bdi>{label(s.folderId).short}</bdi> <span className="pct">{fmt.percent(s.confidence)}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="hint">{t('classify.noSuggestion')}</div>
                    )}
                    <div className="row">
                      <AlbumSelect
                        categories={lib.categories}
                        placeholder={t('classify.otherAlbum')}
                        disabled={isBusy}
                        exclude={rec.folderId}
                        onChoose={(f) => act(rec.id, () => chooseFolder(rec.id, f))}
                      />
                      <button className="btn ghost" disabled={isBusy} onClick={() => act(rec.id, () => keepHere(rec.id))} title={t('classify.keepHereHint')}>
                        <Home size={16} /> {t('classify.keepHere')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="hint">
                      <Sparkles size={14} /> {t('classify.movedTo')} <bdi>{[place.category, place.album].filter(Boolean).join(' / ')}</bdi>{' '}
                      {meta?.confidence ? <span className="pct">{fmt.percent(meta.confidence)}</span> : null}
                    </div>
                    <div className="row">
                      <button className="btn primary" disabled={isBusy} onClick={() => act(rec.id, () => confirmAuto([rec.id]))}>
                        <Check size={16} /> {t('classify.correct')}
                      </button>
                      <AlbumSelect
                        categories={lib.categories}
                        placeholder={t('classify.fix')}
                        disabled={isBusy}
                        exclude={rec.folderId}
                        onChoose={(f) => act(rec.id, () => chooseFolder(rec.id, f))}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {items.length > shown && (
        <div className="empty">
          <button className="btn" onClick={() => setShown((n) => n + PAGE)}>
            {t('classify.showMore', { count: items.length - shown })}
          </button>
        </div>
      )}
      {viewerId && <Viewer ids={ids} items={items} />}
    </div>
  )
}
