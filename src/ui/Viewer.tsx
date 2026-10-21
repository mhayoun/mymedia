import { ChevronLeft, ChevronRight, ExternalLink, FolderPlus, Info, Maximize2, Play, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadBlob } from '../drive/api'
import { useFormat } from '../i18n/format'
import { ORIGINS, type Origin } from '../lib/media'
import { ALBUM_SEPARATOR } from '../lib/tree'
import { bytesBeforePlay, VIDEO_CHANNEL, type VideoProgress } from '../lib/videoBuffer'
import { useApp } from '../store'
import { trashMedia } from '../sync/media'
import { updateMeta } from '../sync/metaStore'
import { streamUrl } from '../sync/stream'
import { loadOriginal, loadPreview, prefetchPreviews, previewIsOriginal, showable } from '../sync/previews'
import { cachedThumbUrl, setViewing } from '../sync/thumbs'
import { chooseFolder } from '../classify/engine'
import { assignFaces, namePerson, removeFaces, splitFaces } from '../faces/engine'
import { AlbumTreeChoice } from './AlbumTreeChoice'
import { CompressDialog } from './CompressDialog'
import { ConfirmDialog } from './Dialog'
import { FaceImg } from './FaceImg'
import { NewAlbumDialog } from './NewAlbumDialog'
import { useLibraryContext } from './libraryContext'
import { useOpenPerson, usePeopleContext } from './peopleContext'
import type { LibraryItem } from './useLibrary'
import { useProvenanceLabel } from './useProvenanceLabel'

const NEW_PERSON = '__new'
const NO_PERSON = '__none'

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
  const readOnly = useApp((s) => s.readOnly)
  const rtl = i18n.dir() === 'rtl'

  useEffect(() => {
    setViewing(true)
    return () => setViewing(false)
  }, [])
  // The next and previous photos are prepared while this one is looked at.
  useEffect(() => {
    const t = setTimeout(() => prefetchPreviews([1, -1, 2, 3].map((d) => byId.get(ids[index + d])?.rec)), 300)
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
          {!readOnly && (
            <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label={t('viewer.delete')} title={t('viewer.delete')}>
              <Trash2 />
            </button>
          )}
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
  const [original, setOriginal] = useObjectUrl()
  const [originalShown, setOriginalShown] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const abort = useRef<AbortController | null>(null)
  // Small photos: the preview already is the original. HEIC: browsers cannot show it.
  const wantOriginal = showable(item.rec) && !previewIsOriginal(item.rec)

  async function fetchOriginal() {
    abort.current = new AbortController()
    setProgress(0)
    try {
      setOriginal(await loadOriginal(item.rec, setProgress, abort.current.signal))
    } catch {
      // cancelled (another photo) or offline: the preview stays
    } finally {
      setProgress(null)
    }
  }

  useEffect(() => {
    let alive = true
    loadPreview(item.rec).then((b) => alive && b && setPreview(b))
    // Full quality at once, except when the phone asks to save data.
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    if (wantOriginal && !saveData) void fetchOriginal()
    return () => {
      alive = false
      abort.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.rec.id])

  const alt = item.meta?.description ?? item.rec.name
  return (
    <>
      {placeholder && !loaded && <img className="placeholder" src={placeholder} alt="" />}
      {/* The preview stays until the full-quality photo is ready, then gives way to it. */}
      {preview && !originalShown && <img src={preview} alt={alt} onLoad={() => setLoaded(true)} />}
      {original && !failed && (
        <img
          src={original}
          alt={alt}
          className={originalShown ? '' : 'loading-original'}
          onLoad={() => {
            setLoaded(true)
            setOriginalShown(true)
          }}
          onError={() => setFailed(true)}
        />
      )}
      <div className="status">
        {progress !== null ? (
          <span>{t('viewer.loadingOriginal', { percent: fmt.percent(progress) })}</span>
        ) : failed ? (
          <span>{t('viewer.cannotShow')}</span>
        ) : wantOriginal && !original ? (
          <button className="btn" onClick={fetchOriginal}>
            <Maximize2 size={16} /> {t('viewer.original')}
          </button>
        ) : null}
      </div>
    </>
  )
}

/** Wi-Fi or a wired connection: no need to wait before playing (where the browser tells). */
function fastConnection(): boolean {
  const type = (navigator as Navigator & { connection?: { type?: string } }).connection?.type
  return type === 'wifi' || type === 'ethernet'
}

/** Without news from the service worker this long, the video just plays. */
const NO_NEWS_MS = 4000
/** The speed is measured over at least this long before deciding. */
const MEASURE_MS = 1500

/**
 * On mobile data: the video loads, paused, until the rest will arrive before
 * it is needed, then plays without stopping. Returns the share loaded of
 * what is needed, null when playing (or not waiting).
 */
function useBufferBeforePlay(
  video: React.RefObject<HTMLVideoElement | null>,
  id: string,
  durationMs: number | undefined,
  active: boolean,
): number | null {
  const [share, setShare] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!active) return
    let done = false
    let first: { at: number; loaded: number } | null = null
    const start = () => {
      if (done) return
      done = true
      setPlaying(true)
      // Refused (e.g. iPhone, not right after a tap): the controls are there.
      video.current?.play().catch(() => undefined)
    }
    const timer = setTimeout(() => !first && start(), NO_NEWS_MS)
    const channel = new BroadcastChannel(VIDEO_CHANNEL)
    channel.onmessage = (e: MessageEvent<VideoProgress>) => {
      const { id: of, loaded, size } = e.data
      if (of !== id || done) return
      if (loaded >= size) return start()
      const now = Date.now()
      if (!first) first = { at: now, loaded }
      const elapsed = (now - first.at) / 1000
      if (elapsed * 1000 < MEASURE_MS) return
      const rate = (loaded - first.loaded) / elapsed
      const d = video.current?.duration
      const duration = d && Number.isFinite(d) ? d : (durationMs ?? 0) / 1000
      const needed = bytesBeforePlay(size, rate, duration)
      if (loaded >= needed) start()
      else setShare(loaded / needed)
    }
    // The user pressed play: they decide.
    const v = video.current
    const onPlay = () => {
      done = true
      setPlaying(true)
    }
    v?.addEventListener('play', onPlay)
    return () => {
      done = true
      clearTimeout(timer)
      channel.close()
      v?.removeEventListener('play', onPlay)
    }
  }, [video, id, durationMs, active])
  return active && !playing ? share : null
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
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Closed or another photo: the service worker stops downloading this video.
  useEffect(() => {
    const id = item.rec.id
    return () => {
      const c = new BroadcastChannel(VIDEO_CHANNEL)
      c.postMessage({ stop: id })
      c.close()
    }
  }, [item.rec.id])
  const [buffered] = useState(() => !fastConnection())
  const waiting = useBufferBeforePlay(videoRef, item.rec.id, item.rec.durationMs, !!stream && buffered)

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
      <>
        <video
          ref={videoRef}
          src={stream}
          poster={poster}
          controls
          autoPlay={!buffered}
          preload="auto"
          playsInline
          onError={() => {
            // Streaming refused (e.g. token being renewed): download instead.
            setStream(null)
            void download()
          }}
        />
        {waiting !== null && (
          <div className="status">
            <span>{t('viewer.buffering', { percent: fmt.percent(waiting) })}</span>
          </div>
        )}
      </>
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
  const provenance = useProvenanceLabel()
  const { t } = useTranslation()
  const fmt = useFormat()
  const { rec, meta, place } = item
  const readOnly = useApp((s) => s.readOnly)
  const set = useApp((s) => s.set)
  const setFilters = useApp((s) => s.setFilters)
  const people = usePeopleContext()
  const openPerson = useOpenPerson()
  const faces = people?.facesOfMedia.get(rec.id) ?? []
  const namedPeople = useMemo(
    () => [...(people?.named ?? [])].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [people],
  )
  // The face being given a new name here, and the name typed.
  const [naming, setNaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const giveName = async (f: (typeof faces)[number]) => {
    const name = newName.trim()
    if (!name) return
    const p = f.personId ? people?.byId.get(f.personId) : undefined
    // A group without a name is named (all its faces); a named face becomes this new person.
    if (p && !p.name) await namePerson(p.id, name)
    else await namePerson(await splitFaces([f.id]), name)
    setNaming(null)
    setNewName('')
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
              <bdi>{provenance.importLabel(meta.imported)}</bdi>
              {meta.imported.path && (
                <div dir="ltr" className="hint" style={{ textAlign: 'start', overflowWrap: 'anywhere' }}>
                  {meta.imported.path}
                </div>
              )}
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
              {meta.toCheck && !meta.novel && <span className="tag warn">{t('classify.toCheck')}</span>}
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
                <div key={f.id} className={`info-face ${f.personId ? '' : 'unknown'}`}>
                  <button
                    onClick={() => {
                      if (!p) return
                      // Read-only: the person's photos (nothing to change about them).
                      if (!readOnly) return openPerson(p.id)
                      setFilters({ personId: p.id, categoryId: null, albumId: null, provenance: null })
                      set({ viewerId: null })
                    }}
                    disabled={!p || (readOnly && !p.name)}
                    title={p?.name ?? (readOnly ? undefined : t('faces.nameIt'))}
                  >
                    <FaceImg face={f} size={48} />
                    <span>{p?.name ? <bdi>{p.name}</bdi> : f.personId ? '?' : t('faces.unknownFace')}</span>
                  </button>
                  {!readOnly && <select
                    value=""
                    aria-label={t('faces.itIs')}
                    onChange={async (e) => {
                      const v = e.target.value
                      if (!v) return
                      if (v === NEW_PERSON) {
                        setNewName('')
                        setNaming(f.id)
                      }
                      else if (v === NO_PERSON) await removeFaces([f.id])
                      else await assignFaces([f.id], v)
                    }}
                  >
                    <option value="">{t('faces.itIs')}</option>
                    {namedPeople.filter((x) => x.id !== p?.id).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                    <option value={NEW_PERSON}>{t('faces.itIsNew')}</option>
                    {/* Not known and not wanted: out of its group, never grouped or asked again. */}
                    {f.personId && <option value={NO_PERSON}>{t('faces.itIsNobody')}</option>}
                  </select>}
                  {naming === f.id && (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void giveName(f)
                      }}
                    >
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('faces.namePlaceholder')}
                        aria-label={t('faces.nameIt')}
                        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setNaming(null))}
                      />
                      <button className="btn primary" type="submit" disabled={!newName.trim()}>
                        {t('common.ok')}
                      </button>
                      <button className="btn ghost" type="button" onClick={() => setNaming(null)}>
                        {t('common.cancel')}
                      </button>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
      {readOnly ? (
        <dl>
          <dt>{t('viewer.origin')}</dt>
          <dd>{t(`origin.${meta?.origin ?? 'unknown'}`)}</dd>
          {meta?.description && (
            <>
              <dt>{t('viewer.description')}</dt>
              <dd dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                {meta.description}
              </dd>
            </>
          )}
        </dl>
      ) : (
        <InfoEdit item={item} />
      )}
    </aside>
  )
}

/** What can be changed about a media: compress, move, origin, description. */
function InfoEdit({ item }: { item: LibraryItem }) {
  const { t } = useTranslation()
  const lib = useLibraryContext()
  const { rec, meta } = item
  const [moving, setMoving] = useState(false)
  const [compressOpen, setCompressOpen] = useState(false)
  const [newAlbumOpen, setNewAlbumOpen] = useState(false)
  const [description, setDescription] = useState(meta?.description ?? '')
  const saveDescription = () => {
    const value = description.trim()
    if (value !== (meta?.description ?? '')) void updateMeta(rec.id, { description: value || undefined })
  }
  return (
    <>
      {!rec.appProperties?.mymedia_compressed && (
        <button className="btn" style={{ marginBlockEnd: 12 }} onClick={() => setCompressOpen(true)}>
          {t('compress.button')}
        </button>
      )}
      {compressOpen && <CompressDialog mode="manual" title={t('compress.titleFor', { name: rec.name })} items={[rec]} onClose={() => setCompressOpen(false)} />}
      {lib && (
        <div className="field">
          {t('classify.moveTo')}
          <AlbumTreeChoice
            categories={lib.categories}
            label={t('classify.otherAlbum')}
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
        </div>
      )}
      {lib && (
        <button type="button" className="btn" style={{ marginBlockEnd: 12 }} disabled={moving} onClick={() => setNewAlbumOpen(true)}>
          <FolderPlus size={16} /> {t('viewer.newAlbum')}
        </button>
      )}
      {lib && newAlbumOpen && <NewAlbumDialog lib={lib} ids={[rec.id]} onClose={() => setNewAlbumOpen(false)} />}
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
    </>
  )
}
