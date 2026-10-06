import { ChevronLeft, ChevronRight, ExternalLink, Info, Maximize2, Play, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { downloadBlob, getFile } from '../drive/api'
import { useFormat } from '../i18n/format'
import { ORIGINS, sizedThumbnailLink, type Origin } from '../lib/media'
import { ALBUM_SEPARATOR } from '../lib/tree'
import { useApp } from '../store'
import { trashMedia } from '../sync/media'
import { updateMeta } from '../sync/metaStore'
import { cachedThumbUrl } from '../sync/thumbs'
import { chooseFolder } from '../classify/engine'
import { AlbumSelect } from './AlbumSelect'
import { ConfirmDialog } from './Dialog'
import { useLibraryContext } from './libraryContext'
import type { LibraryItem } from './useLibrary'

const PREVIEW_SIZE = 2048

interface Props {
  ids: string[]
  items: LibraryItem[]
}

export function Viewer({ ids, items }: Props) {
  const { t, i18n } = useTranslation()
  const viewerId = useApp((s) => s.viewerId)!
  const set = useApp((s) => s.set)
  const byId = useMemo(() => new Map(items.map((i) => [i.rec.id, i])), [items])
  const item = byId.get(viewerId)
  const index = ids.indexOf(viewerId)
  const [showInfo, setShowInfo] = useState(() => window.innerWidth > 800)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const rtl = i18n.dir() === 'rtl'

  const close = useCallback(() => set({ viewerId: null }), [set])
  const go = useCallback(
    (delta: number) => {
      const next = ids[index + delta]
      if (next) set({ viewerId: next })
    },
    [ids, index, set],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (document.querySelector('.modal-backdrop')) return // a dialog handles its own keys
      if (e.key === 'Escape') close()
      // In Hebrew the "next" photo is on the left.
      if (e.key === 'ArrowRight') go(rtl ? -1 : 1)
      if (e.key === 'ArrowLeft') go(rtl ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, go, rtl])

  const touchX = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => (touchX.current = e.touches[0].clientX)
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return
    const dx = e.changedTouches[0].clientX - touchX.current
    touchX.current = null
    if (Math.abs(dx) < 50) return
    // Swiping towards the reading direction's start shows the next item.
    const isNext = rtl ? dx > 0 : dx < 0
    go(isNext ? 1 : -1)
  }

  if (!item) return null

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={item.rec.name}>
      <div className="stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="top">
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X />
          </button>
          <span className="name">
            <bdi>{item.rec.name}</bdi>
          </span>
          {item.rec.webViewLink && (
            <a className="icon-btn" href={item.rec.webViewLink} target="_blank" rel="noreferrer" aria-label={t('viewer.openInDrive')} title={t('viewer.openInDrive')}>
              <ExternalLink />
            </a>
          )}
          <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label={t('viewer.delete')} title={t('viewer.delete')}>
            <Trash2 />
          </button>
          <button className="icon-btn" onClick={() => setShowInfo((v) => !v)} aria-label={t('viewer.info')} aria-pressed={showInfo}>
            <Info />
          </button>
        </div>
        {index > 0 && (
          <button className="icon-btn nav prev" onClick={() => go(-1)} aria-label={t('common.previous')}>
            <ChevronLeft className="flip-rtl" />
          </button>
        )}
        {index < ids.length - 1 && (
          <button className="icon-btn nav next" onClick={() => go(1)} aria-label={t('common.next')}>
            <ChevronRight className="flip-rtl" />
          </button>
        )}
        {item.rec.type === 'photo' ? <PhotoStage key={item.rec.id} item={item} /> : <VideoStage key={item.rec.id} item={item} />}
      </div>
      {showInfo && <InfoPanel key={item.rec.id} item={item} />}
      {confirmDelete && (
        <ConfirmDialog
          title={t('viewer.deleteTitle', { name: item.rec.name })}
          text={t('viewer.deleteText')}
          confirmLabel={t('viewer.delete')}
          danger
          onConfirm={async () => {
            // Show the next item (or the previous one at the end) once deleted.
            const after = ids[index + 1] ?? ids[index - 1] ?? null
            await trashMedia(item.rec.id)
            set({ viewerId: after })
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function usePreviewLink(item: LibraryItem): [string | null, () => void] {
  const [link, setLink] = useState(() =>
    item.rec.thumbnailLink ? sizedThumbnailLink(item.rec.thumbnailLink, PREVIEW_SIZE) : null,
  )
  const refreshed = useRef(false)
  const refresh = useCallback(() => {
    if (refreshed.current) return setLink(null)
    refreshed.current = true
    getFile(item.rec.id, 'id,thumbnailLink')
      .then(async (f) => {
        if (!f.thumbnailLink) return setLink(null)
        await db().media.update(item.rec.id, { thumbnailLink: f.thumbnailLink })
        setLink(sizedThumbnailLink(f.thumbnailLink, PREVIEW_SIZE))
      })
      .catch(() => setLink(null))
  }, [item.rec.id])
  return [link, refresh]
}

function useObjectUrl() {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  return [url, (blob: Blob) => setUrl(URL.createObjectURL(blob))] as const
}

function PhotoStage({ item }: { item: LibraryItem }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const placeholder = cachedThumbUrl(item.rec.id)
  const [preview, refreshPreview] = usePreviewLink(item)
  const [loaded, setLoaded] = useState(false)
  const [original, setOriginal] = useObjectUrl()
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  async function loadOriginal() {
    setProgress(0)
    try {
      setOriginal(await downloadBlob(item.rec.id, setProgress))
    } finally {
      setProgress(null)
    }
  }

  return (
    <>
      {placeholder && !loaded && <img className="placeholder" src={placeholder} alt="" />}
      {original && !failed ? (
        <img src={original} alt={item.meta?.description ?? item.rec.name} onError={() => setFailed(true)} />
      ) : preview ? (
        <img
          src={preview}
          alt={item.meta?.description ?? item.rec.name}
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={refreshPreview}
        />
      ) : null}
      <div className="status">
        {progress !== null ? (
          <span>{t('viewer.downloading', { percent: fmt.percent(progress) })}</span>
        ) : failed ? (
          <span>{t('viewer.cannotShow')}</span>
        ) : !original ? (
          <button className="btn" onClick={loadOriginal}>
            <Maximize2 size={16} /> {t('viewer.original')}
          </button>
        ) : null}
      </div>
    </>
  )
}

function VideoStage({ item }: { item: LibraryItem }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const poster = cachedThumbUrl(item.rec.id)
  const [src, setSrc] = useObjectUrl()
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  async function play() {
    abort.current = new AbortController()
    setProgress(0)
    try {
      setSrc(await downloadBlob(item.rec.id, setProgress, abort.current.signal))
    } catch {
      // cancelled or failed: stay on the poster
    } finally {
      setProgress(null)
    }
  }

  if (src && !failed) return <video src={src} controls autoPlay playsInline onError={() => setFailed(true)} />
  return (
    <>
      {poster && <img className="placeholder" src={poster} alt="" style={{ filter: 'none', opacity: 1 }} />}
      {progress === null && !failed && (
        <button className="center-play" onClick={play} aria-label={t('gallery.video')}>
          <Play size={34} className="flip-rtl" />
        </button>
      )}
      <div className="status">
        {progress !== null && <span>{t('viewer.downloading', { percent: fmt.percent(progress) })}</span>}
        {failed && (
          <span>
            {t('viewer.cannotPlay')}{' '}
            {item.rec.webViewLink && (
              <a href={item.rec.webViewLink} target="_blank" rel="noreferrer">
                {t('viewer.openInDrive')}
              </a>
            )}
          </span>
        )}
      </div>
    </>
  )
}

function InfoPanel({ item }: { item: LibraryItem }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const lib = useLibraryContext()
  const { rec, meta, place } = item
  const [moving, setMoving] = useState(false)
  const [description, setDescription] = useState(meta?.description ?? '')

  const saveDescription = () => {
    const value = description.trim()
    if (value !== (meta?.description ?? '')) void updateMeta(rec.id, { description: value || undefined })
  }

  return (
    <aside className="info-panel">
      <dl>
        <dt>{t('viewer.date')}</dt>
        <dd>{fmt.dateTime(rec.takenAt)}</dd>
        <dt>{t('viewer.size')}</dt>
        <dd>{fmt.bytes(rec.size)}</dd>
        {rec.width && rec.height ? (
          <>
            <dt>{t('viewer.dimensions')}</dt>
            <dd dir="ltr" style={{ textAlign: 'start' }}>
              {fmt.number(rec.width)} × {fmt.number(rec.height)}
            </dd>
          </>
        ) : null}
        {rec.durationMs ? (
          <>
            <dt>{t('viewer.duration')}</dt>
            <dd>{fmt.duration(rec.durationMs)}</dd>
          </>
        ) : null}
        <dt>{t('viewer.category')}</dt>
        <dd>
          <bdi>{place.category ?? t('nav.unfiled')}</bdi>
        </dd>
        {place.album && (
          <>
            <dt>{t('viewer.album')}</dt>
            <dd>
              {place.album.split(ALBUM_SEPARATOR).map((p, i) => (
                <span key={i}>
                  {i > 0 && ' / '}
                  <bdi>{p}</bdi>
                </span>
              ))}
            </dd>
          </>
        )}
        {meta?.source && (
          <>
            <dt>{t('classify.source')}</dt>
            <dd>
              {t(`classify.sources.${meta.source}`)}
              {meta.confidence != null && meta.source !== 'folder' && meta.source !== 'manual' ? ` · ${fmt.percent(meta.confidence)}` : ''}
              {meta.auto && <span className="tag auto">{t('classify.autoTag')}</span>}
              {meta.toCheck && <span className="tag warn">{t('classify.toCheck')}</span>}
            </dd>
          </>
        )}
      </dl>
      {lib && (
        <label className="field">
          {t('classify.moveTo')}
          <AlbumSelect
            categories={lib.categories}
            placeholder={t('classify.otherAlbum')}
            disabled={moving}
            exclude={rec.folderId}
            onChoose={async (folderId) => {
              setMoving(true)
              try {
                await chooseFolder(rec.id, folderId)
              } finally {
                setMoving(false)
              }
            }}
          />
        </label>
      )}
      <label className="field">
        {t('viewer.origin')}
        <select
          value={meta?.origin ?? 'unknown'}
          disabled={!meta}
          onChange={(e) => void updateMeta(rec.id, { origin: e.target.value as Origin, originManual: true })}
        >
          {ORIGINS.map((o) => (
            <option key={o} value={o}>
              {t(`origin.${o}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t('viewer.description')}
        <textarea
          dir="auto"
          value={description}
          disabled={!meta}
          placeholder={t('viewer.descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
        />
      </label>
    </aside>
  )
}
