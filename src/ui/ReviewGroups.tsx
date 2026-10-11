import { Check, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chooseFolder, confirmAuto } from '../classify/engine'
import { useFormat } from '../i18n/format'
import { placementOf } from '../lib/tree'
import { app, useApp } from '../store'
import { trashMedia } from '../sync/media'
import { prepareLinks } from '../sync/thumbs'
import { AlbumSelect } from './AlbumSelect'
import { ConfirmDialog } from './Dialog'
import { Thumb } from './Thumb'
import type { Library, LibraryItem } from './useLibrary'

const PAGE = 48
const NONE = ''

interface Group {
  /** The proposed album ("To classify") or the album it was put in ("Auto"); NONE: no suggestion. */
  folderId: string
  items: LibraryItem[]
}

/** "To classify" and "Auto" in the Albums view: photos grouped by album, a whole group accepted at once. */
export function ReviewGroups({ lib, items, mode }: { lib: Library; items: LibraryItem[]; mode: 'classify' | 'auto' }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [shown, setShown] = useState<Record<string, number>>({})
  const [toDelete, setToDelete] = useState<{ key: string; ids: string[] } | null>(null)

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, LibraryItem[]>()
    for (const i of items) {
      const key = mode === 'auto' ? i.rec.folderId : (i.meta?.suggestions?.[0]?.folderId ?? NONE)
      map.set(key, [...(map.get(key) ?? []), i])
    }
    const conf = (i: LibraryItem) => (mode === 'auto' ? i.meta?.confidence : i.meta?.suggestions?.[0]?.confidence) ?? 0
    return [...map.entries()]
      .map(([folderId, list]) => ({ folderId, items: list.sort((a, b) => conf(b) - conf(a)) }))
      .sort((a, b) => (a.folderId === NONE ? 1 : b.folderId === NONE ? -1 : b.items.length - a.items.length))
  }, [items, mode])

  useEffect(() => {
    prepareLinks(groups.flatMap((g) => g.items.slice(0, PAGE).map((i) => i.rec)))
  }, [groups])

  const name = (folderId: string) => {
    const p = placementOf(folderId, lib.folders, rootId)
    return [p.category, p.album].filter(Boolean).join(' / ')
  }

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleGroup = (g: Group, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s)
      for (const i of g.items) {
        if (on) n.add(i.rec.id)
        else n.delete(i.rec.id)
      }
      return n
    })

  const run = async (key: string, ids: string[], fn: (id: string) => Promise<unknown>) => {
    setBusy(key)
    setProgress({ done: 0, total: ids.length })
    try {
      for (let k = 0; k < ids.length; k++) {
        await fn(ids[k])
        setProgress({ done: k + 1, total: ids.length })
      }
      setPicked((s) => new Set([...s].filter((id) => !ids.includes(id))))
    } catch (e) {
      console.error(e)
      app().set({ error: 'errors.syncFailed' })
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <div className="review-groups">
      <p className="hint">{t('classify.groupHint')}</p>
      {groups.map((g) => {
        const key = g.folderId || 'none'
        const sel = g.items.filter((i) => picked.has(i.rec.id)).map((i) => i.rec.id)
        const all = sel.length === g.items.length
        const isBusy = busy !== null
        const limit = shown[key] ?? PAGE
        return (
          <section className="review-group" key={key} aria-busy={busy === key}>
            <div className="review-group-head">
              <label className="check-row">
                <input type="checkbox" checked={all} disabled={isBusy} onChange={(e) => toggleGroup(g, e.target.checked)} />
                <strong>
                  <bdi>{g.folderId ? name(g.folderId) : t('classify.groupNone')}</bdi>
                </strong>
                <span className="count">{fmt.number(g.items.length)}</span>
              </label>
              <span className="row">
                {g.folderId && (
                  <button
                    className="btn primary"
                    disabled={isBusy || !sel.length}
                    onClick={() =>
                      mode === 'auto'
                        ? run(key, sel, (id) => confirmAuto([id]))
                        : run(key, sel, (id) => chooseFolder(id, g.folderId))
                    }
                  >
                    <Check size={16} />
                    {mode === 'auto'
                      ? t('classify.groupCorrect', { count: sel.length })
                      : t('classify.groupMove', { count: sel.length, name: name(g.folderId).split(' / ').pop() })}
                  </button>
                )}
                <AlbumSelect
                  categories={lib.categories}
                  placeholder={t('classify.groupOther')}
                  disabled={isBusy || !sel.length}
                  exclude={mode === 'auto' ? g.folderId : undefined}
                  onChoose={(f) => run(key, sel, (id) => chooseFolder(id, f))}
                />
                <button
                  className="btn ghost"
                  disabled={isBusy || !sel.length}
                  onClick={() => setToDelete({ key, ids: sel })}
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={16} />
                </button>
              </span>
              {busy === key && progress && (
                <span className="hint">
                  <Loader2 size={14} className="spin" /> {t('select.working', { done: fmt.number(progress.done), total: fmt.number(progress.total) })}
                </span>
              )}
            </div>
            <div className="review-group-grid">
              {g.items.slice(0, limit).map((i) => {
                const c = mode === 'auto' ? i.meta?.confidence : i.meta?.suggestions?.[0]?.confidence
                return (
                  <div className="review-group-cell" key={i.rec.id} title={i.meta?.description || i.rec.name}>
                    <Thumb rec={i.rec} selected={picked.has(i.rec.id)} onOpen={(id) => !isBusy && toggle(id)} />
                    {c ? <span className="pct">{fmt.percent(c)}</span> : null}
                    {i.meta?.novel && <span className="tag warn">{t('classify.novel')}</span>}
                  </div>
                )
              })}
            </div>
            {g.items.length > limit && (
              <button className="btn ghost" onClick={() => setShown((s) => ({ ...s, [key]: limit + PAGE }))}>
                {t('classify.showMore', { count: g.items.length - limit })}
              </button>
            )}
          </section>
        )
      })}
      {toDelete && (
        <ConfirmDialog
          title={t('select.deleteTitle', { count: toDelete.ids.length })}
          text={t('viewer.deleteText')}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={() => run(toDelete.key, toDelete.ids, (id) => trashMedia(id))}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
