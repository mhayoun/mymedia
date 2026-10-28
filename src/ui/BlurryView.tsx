import { Check, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { useFormat } from '../i18n/format'
import { measureSharpness, NOT_BLURRY_KEY, type BlurSearch } from '../quality/cleanup'
import { app, useApp } from '../store'
import { trashMedia } from '../sync/media'
import { Thumb } from './Thumb'
import type { Library } from './useLibrary'
import { Viewer } from './Viewer'

const PAGE = 60
/** Severity slider: a photo is blurred under this sharpness (see lib/sharpness). */
const MIN_LEVEL = 10
const MAX_LEVEL = 300
const DEFAULT_LEVEL = 80

/**
 * "Blurred photos": the photos where nothing is sharp, most blurred first,
 * measured on the thumbnails already on the device.
 */
export function BlurryView({ lib }: { lib: Library }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const viewerId = useApp((s) => s.viewerId)
  const set = useApp((s) => s.set)
  const [found, setFound] = useState<BlurSearch | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(DEFAULT_LEVEL)
  const [notBlurry, setNotBlurry] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState(PAGE)

  useEffect(() => {
    const signal = { cancelled: false }
    ;(async () => {
      setNotBlurry(new Set((await db().getKv<string[]>(NOT_BLURRY_KEY)) ?? []))
      const result = await measureSharpness(rootId, (done, total) => setProgress({ done, total }), signal)
      if (!signal.cancelled) setFound(result)
    })().catch((e) => !signal.cancelled && setError(String(e)))
    return () => {
      signal.cancelled = true
    }
  }, [rootId])

  const items = useMemo(() => {
    if (!found) return []
    return lib.items
      .filter((i) => !notBlurry.has(i.rec.id) && (found.scores.get(i.rec.id) ?? Infinity) < level)
      .sort((a, b) => found.scores.get(a.rec.id)! - found.scores.get(b.rec.id)!)
  }, [found, lib.items, level, notBlurry])
  const selected = items.filter((i) => checked.has(i.rec.id)).map((i) => i.rec.id)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setChecked(new Set())
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const trash = () =>
    run(async () => {
      for (const id of selected) await trashMedia(id)
      app().set({ toast: { key: 'cleanup.trashed', count: selected.length } })
    })
  const markSharp = (ids: string[]) =>
    run(async () => {
      const next = new Set([...notBlurry, ...ids])
      await db().setKv(NOT_BLURRY_KEY, [...next])
      setNotBlurry(next)
    })
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  if (error) return <p className="error-text">{error}</p>
  if (!found)
    return (
      <div className="review">
        <p className="review-bar">
          <Loader2 size={16} className="spin" />{' '}
          {progress?.total ? t('cleanup.blurComputing', { done: fmt.number(progress.done), total: fmt.number(progress.total) }) : t('common.loading')}
        </p>
      </div>
    )

  const visible = items.slice(0, shown)
  return (
    <div className="review">
      <div className="review-bar">
        <label className="cleanup-slider">
          {t('cleanup.severity')}
          <input type="range" min={MIN_LEVEL} max={MAX_LEVEL} step={5} value={level} onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
        <p className="hint">
          {items.length ? t('cleanup.blurHint', { count: items.length }) : t('cleanup.blurNone')}
          {found.missing > 0 && <> {t('cleanup.blurMissing', { count: found.missing })}</>}
        </p>
        <button className="btn ghost" disabled={busy || !items.length} onClick={() => setChecked(new Set(visible.map((i) => i.rec.id)))}>
          {t('cleanup.selectShown')}
        </button>
        <button className="btn" disabled={busy || !selected.length} onClick={trash}>
          <Trash2 size={16} /> {t('cleanup.trash', { count: selected.length })}
        </button>
        <button className="btn ghost" disabled={busy || !selected.length} onClick={() => markSharp(selected)}>
          <Check size={16} /> {t('cleanup.notBlurry', { count: selected.length })}
        </button>
      </div>
      <div className="blur-grid" aria-busy={busy}>
        {visible.map((it) => (
          <figure key={it.rec.id} className={`dup-item ${checked.has(it.rec.id) ? 'marked' : ''}`}>
            <Thumb rec={it.rec} onOpen={(id) => set({ viewerId: id })} />
            <figcaption>
              <label className="row">
                <input type="checkbox" checked={checked.has(it.rec.id)} onChange={() => toggle(it.rec.id)} />
                {t('cleanup.sharpness', { n: Math.round(found.scores.get(it.rec.id)!) })}
              </label>
            </figcaption>
          </figure>
        ))}
      </div>
      {items.length > shown && (
        <button className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>
          {t('classify.showMore', { count: items.length - shown })}
        </button>
      )}
      {viewerId && <Viewer ids={visible.map((i) => i.rec.id)} items={visible} />}
    </div>
  )
}
