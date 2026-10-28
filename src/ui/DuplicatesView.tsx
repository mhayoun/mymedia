import { Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { useFormat } from '../i18n/format'
import { groupPairs, MIN_SIMILAR, pairKey } from '../lib/similar'
import { placementOf } from '../lib/tree'
import { findDuplicates, NOT_DUPLICATES_KEY, type DuplicateSearch } from '../quality/cleanup'
import { app, useApp } from '../store'
import { trashMedia } from '../sync/media'
import { Thumb } from './Thumb'
import type { Library, LibraryItem } from './useLibrary'
import { Viewer } from './Viewer'

const PAGE = 30

/** The one to keep first: most pixels, then biggest file, then oldest in Drive. */
function bestFirst(a: LibraryItem, b: LibraryItem): number {
  const px = (i: LibraryItem) => (i.rec.width ?? 0) * (i.rec.height ?? 0)
  return px(b) - px(a) || b.rec.size - a.rec.size || a.rec.createdTime.localeCompare(b.rec.createdTime)
}

/**
 * "Duplicates": groups of photos that look alike (same file, or a
 * resemblance above the chosen threshold). The best of each group is kept,
 * the others go to Drive's bin (30 days to get them back).
 */
export function DuplicatesView({ lib }: { lib: Library }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const viewerId = useApp((s) => s.viewerId)
  const set = useApp((s) => s.set)
  const [found, setFound] = useState<DuplicateSearch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(95)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  /** Photos unticked by the user (kept), and ticked by the user (to the bin). */
  const [keep, setKeep] = useState<Set<string>>(new Set())
  const [drop, setDrop] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const no = (await db().getKv<string[]>(NOT_DUPLICATES_KEY)) ?? []
      const result = await findDuplicates(rootId)
      if (!alive) return
      setDismissed(new Set(no))
      setFound(result)
    })().catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [rootId])

  const byId = useMemo(() => new Map(lib.items.map((i) => [i.rec.id, i])), [lib.items])
  const groups = useMemo(() => {
    if (!found) return []
    // Photos removed meanwhile are left out.
    const pairs = found.pairs.filter((p) => byId.has(p.a) && byId.has(p.b))
    return groupPairs(pairs, threshold / 100, dismissed)
      .map((g) => ({ ...g, items: g.ids.map((id) => byId.get(id)!).sort(bestFirst) }))
      .sort((a, b) => b.score - a.score || b.items.length - a.items.length)
  }, [found, byId, threshold, dismissed])

  const toBin = (items: LibraryItem[]) =>
    items.filter((it, i) => (i === 0 ? drop.has(it.rec.id) : !keep.has(it.rec.id))).map((it) => it.rec.id)
  const toggle = (id: string, first: boolean) => {
    const flip = (s: Set<string>) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    }
    if (first) setDrop(flip)
    else setKeep(flip)
  }

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(key))
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(key)
        return n
      })
    }
  }
  const trash = (key: string, ids: string[]) =>
    run(key, async () => {
      for (const id of ids) await trashMedia(id)
      app().set({ toast: { key: 'cleanup.trashed', count: ids.length } })
    })
  const notDuplicates = (key: string, ids: string[]) =>
    run(key, async () => {
      const keys = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => pairKey(a, b)))
      const next = new Set([...dismissed, ...keys])
      await db().setKv(NOT_DUPLICATES_KEY, [...next])
      setDismissed(next)
    })

  const place = (folderId: string) => {
    const p = placementOf(folderId, lib.folders, rootId)
    return p.album?.split(' / ').pop() ?? p.category ?? ''
  }

  if (error) return <p className="error-text">{error}</p>
  if (!found)
    return (
      <div className="review">
        <p className="review-bar">
          <Loader2 size={16} className="spin" /> {t('cleanup.dupComputing')}
        </p>
      </div>
    )

  const visible = groups.slice(0, shown)
  return (
    <div className="review">
      <div className="review-bar">
        <label className="cleanup-slider">
          {t('cleanup.similarity', { n: threshold })}
          <input type="range" min={Math.round(MIN_SIMILAR * 100)} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <p className="hint">
          {groups.length ? t('cleanup.dupHint', { count: groups.length }) : t('cleanup.dupNone')}
          {found.waiting > 0 && <> {t('cleanup.dupWaiting', { count: found.waiting })}</>}
        </p>
      </div>
      {visible.map((g) => {
        const key = g.ids.slice().sort().join(',')
        const bin = toBin(g.items)
        const isBusy = busy.has(key)
        return (
          <section className="dup-group" key={key} aria-busy={isBusy}>
            <header className="row">
              <strong>{g.score >= 0.999 ? t('cleanup.sameFile') : t('cleanup.alike', { n: Math.round(g.score * 100) })}</strong>
              <span className="grow" />
              <button className="btn" disabled={isBusy || bin.length === 0} onClick={() => trash(key, bin)}>
                <Trash2 size={16} /> {t('cleanup.trash', { count: bin.length })}
              </button>
              <button className="btn ghost" disabled={isBusy} onClick={() => notDuplicates(key, g.ids)}>
                <X size={16} /> {t('cleanup.notDuplicates')}
              </button>
            </header>
            <div className="dup-row">
              {g.items.map((it, i) => {
                const marked = bin.includes(it.rec.id)
                return (
                  <figure key={it.rec.id} className={`dup-item ${marked ? 'marked' : ''}`}>
                    <Thumb rec={it.rec} onOpen={(id) => set({ viewerId: id })} />
                    <figcaption>
                      <label className="row">
                        <input type="checkbox" checked={marked} onChange={() => toggle(it.rec.id, i === 0)} />
                        {marked ? t('cleanup.toBin') : i === 0 ? t('cleanup.best') : t('cleanup.keep')}
                      </label>
                      <div className="hint">
                        {it.rec.width && it.rec.height ? `${it.rec.width}×${it.rec.height} · ` : ''}
                        {fmt.bytes(it.rec.size)}
                      </div>
                      <div className="hint">{fmt.date(it.rec.takenAt)}</div>
                      <div className="hint" title={it.rec.name}>
                        <bdi>{place(it.rec.folderId) || it.rec.name}</bdi>
                      </div>
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          </section>
        )
      })}
      {groups.length > shown && (
        <button className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>
          {t('classify.showMore', { count: groups.length - shown })}
        </button>
      )}
      {viewerId && <Viewer ids={visible.flatMap((g) => g.items.map((i) => i.rec.id))} items={visible.flatMap((g) => g.items)} />}
    </div>
  )
}
