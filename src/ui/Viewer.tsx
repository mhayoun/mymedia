import { ChevronLeft, ChevronRight, ExternalLink, Info, Maximize2, Play, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadBlob } from '../drive/api'
import { useFormat } from '../i18n/format'
import { ORIGINS, type Origin } from '../lib/media'
import { ALBUM_SEPARATOR } from '../lib/tree'
import { useApp } from '../store'
import { trashMedia } from '../sync/media'
import { updateMeta } from '../sync/metaStore'
import { streamUrl } from '../sync/stream'
import { loadPreview, prefetchPreviews } from '../sync/previews'
import { cachedThumbUrl } from '../sync/thumbs'
import { chooseFolder } from '../classify/engine'
import { AlbumSelect } from './AlbumSelect'
import { CompressDialog } from './CompressDialog'
import { ConfirmDialog } from './Dialog'
import { FaceImg } from './FaceImg'
import { useLibraryContext } from './libraryContext'
import { useOpenPerson, usePeopleContext } from './peopleContext'
import type { LibraryItem } from './useLibrary'

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

  // The next and previous photos are prepared while this one is looked at.
  useEffect(() => {
    const t = setTimeout(() => prefetchPreviews([1, -1, 2].map((d) => byId.get(ids[index + d])?.rec)), 300)
    return () => clearTimeout(t)
  }, [byId, ids, index])

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
  const [preview, setPreview] = useObjectUrl()
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    loadPreview(item.rec).then((b) => alive && b && setPreview(b))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.rec.id])
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
          onLoad={() => setLoaded(true)}
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
  const [stream, setStream] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  async function download() {
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

  async function play() {
    // Streaming plays at once; downloading everything first is the fallback.
    const url = await streamUrl(item.rec)
    if (url) setStream(url)
    else await download()
  }

  if (stream && !failed)
    return (
      <video
        src={stream}
        poster={poster}
        controls
        autoPlay
        playsInline
        onError={() => {
          // Streaming refused (e.g. token being renewed): download instead.
          setStream(null)
          void download()
        }}
      />
    )
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
  const [compressOpen, setCompressOpen] = useState(false)
  const people = usePeopleContext()
  const openPerson = useOpenPerson()
  const faces = people?.facesOfMedia.get(rec.id) ?? []
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
        {meta?.group && (
          <>
            <dt>{t('viewer.group')}</dt>
            <dd>
              <bdi>{meta.group}</bdi>
            </dd>
          </>
        )}
        {meta?.imported && (
          <>
            <dt>{t('viewer.imported')}</dt>
            <dd>
              <bdi>{meta.imported.from || t('provenance.looseFiles')}</bdi> · {fmt.date(`${meta.imported.on}T12:00:00`)}
            </dd>
          </>
        )}
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
        <dt>{t('compress.status')}</dt>
        <dd>
          {meta?.compression?.status === 'compressed' && meta.compression.sizeBefore
            ? t('compress.statusDone', { before: fmt.bytes(meta.compression.sizeBefore), after: fmt.bytes(meta.compression.sizeAfter ?? rec.size) })
            : t(`compress.statusLabel.${meta?.compression?.status ?? (rec.appProperties?.mymedia_compressed ? 'compressed' : 'not')}`)}
        </dd>
      </dl>
      {faces.length > 0 && (
        <>
          <div className="hint">{t('faces.inThisPhoto')}</div>
          <div className="info-faces">
            {faces.map((f) => {
              const p = f.personId ? people?.byId.get(f.personId) : undefined
              return (
                <button key={f.id} onClick={() => p && openPerson(p.id)} disabled={!p} title={p?.name ?? t('faces.nameIt')}>
                  <FaceImg face={f} size={48} />
                  <span>{p?.name ? <bdi>{p.name}</bdi> : '?'}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
      {!rec.appProperties?.mymedia_compressed && (
        <button className="btn" style={{ marginBlockEnd: 12 }} onClick={() => setCompressOpen(true)}>
          {t('compress.button')}
        </button>
      )}
      {compressOpen && <CompressDialog mode="manual" title={t('compress.titleFor', { name: rec.name })} items={[rec]} onClose={() => setCompressOpen(false)} />}
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
