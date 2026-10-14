import { Check, Loader2, MoveRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { labeledSet, loadData } from '../classify/data'
import { chooseFolder } from '../classify/engine'
import { db } from '../db/db'
import type { Misfiled } from '../lib/classifier'
import { folderChain, placementOf } from '../lib/tree'
import { misfiledIn } from '../ml/ml'
import { useApp } from '../store'
import { AlbumSelect } from './AlbumSelect'
import { Thumb } from './Thumb'
import type { Library } from './useLibrary'
import { Viewer } from './Viewer'

const PAGE = 60
/** Photos the user said are in the right album (this device): "<id>:<album>". */
const OK_KEY = 'misfiledOk'

/**
 * "Possibly misfiled": photos of an album that look more like another album
 * of the same category. A wrong example teaches the model the mistake.
 */
export function MisfiledView({ lib }: { lib: Library }) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)!
  const viewerId = useApp((s) => s.viewerId)
  const set = useApp((s) => s.set)
  const [found, setFound] = useState<Misfiled[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const data = await loadData(rootId)
      const { set: packed } = labeledSet(data)
      const groups: Record<string, string> = {}
      for (const label of new Set(packed.labels)) groups[label] = folderChain(label, data.folders, rootId)?.[0]?.id ?? label
      const ok = new Set((await db().getKv<string[]>(OK_KEY)) ?? [])
      const list = packed.ids.length >= 2 ? await misfiledIn(packed, groups) : []
      if (alive) setFound(list.filter((m) => !ok.has(`${m.id}:${m.label}`)))
    })().catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [rootId])

  const byId = useMemo(() => new Map(lib.items.map((i) => [i.rec.id, i])), [lib.items])
  // Still where it was when checked (moved meanwhile: no longer shown).
  const rows = (found ?? []).filter((m) => byId.get(m.id)?.rec.folderId === m.label)
  const items = rows.map((m) => byId.get(m.id)!)
  const name = (folderId: string) => {
    const p = placementOf(folderId, lib.folders, rootId)
    return p.album?.split(' / ').pop() ?? p.category ?? ''
  }

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy((b) => new Set(b).add(id))
    try {
      await fn()
      setFound((f) => f?.filter((m) => m.id !== id) ?? null)
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(id)
        return n
      })
    }
  }
  const rightPlace = (m: Misfiled) =>
    act(m.id, async () => {
      const d = db()
      const ok = (await d.getKv<string[]>(OK_KEY)) ?? []
      await d.setKv(OK_KEY, [...ok, `${m.id}:${m.label}`])
    })

  if (error) return <p className="error-text">{error}</p>
  if (!found)
    return (
      <div className="review">
        <p>
          <Loader2 size={16} className="spin" /> {t('misfiled.computing')}
        </p>
      </div>
    )

  return (
    <div className="review">
      <p className="hint">{rows.length ? t('misfiled.hint', { count: rows.length }) : t('misfiled.none')}</p>
      <div className="review-grid">
        {rows.slice(0, shown).map((m) => {
          const it = byId.get(m.id)!
          const isBusy = busy.has(m.id)
          return (
            <div className="review-card" key={m.id} aria-busy={isBusy}>
              <Thumb rec={it.rec} onOpen={(id) => set({ viewerId: id })} />
              <div className="review-body">
                <div className="review-name" title={it.rec.name}>
                  <bdi>{it.meta?.description || it.rec.name}</bdi>
                </div>
                <div className="hint">
                  {t('misfiled.in')} <bdi>{name(m.label)}</bdi>
                </div>
                <button className="btn primary suggestion" disabled={isBusy} onClick={() => act(m.id, () => chooseFolder(m.id, m.other))}>
                  <MoveRight size={16} className="flip-rtl" />
                  <bdi>{t('misfiled.moveTo', { name: name(m.other) })}</bdi>
                </button>
                <div className="row">
                  <AlbumSelect
                    categories={lib.categories}
                    placeholder={t('classify.otherAlbum')}
                    disabled={isBusy}
                    exclude={m.label}
                    onChoose={(f) => act(m.id, () => chooseFolder(m.id, f))}
                  />
                  <button className="btn ghost" disabled={isBusy} onClick={() => rightPlace(m)} title={t('misfiled.rightPlaceHint')}>
                    <Check size={16} /> {t('misfiled.rightPlace')}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {rows.length > shown && (
        <button className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>
          {t('classify.showMore', { count: rows.length - shown })}
        </button>
      )}
      {viewerId && <Viewer ids={items.map((i) => i.rec.id)} items={items} />}
    </div>
  )
}
