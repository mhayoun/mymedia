// A MyMedia shared by a link (Share → "Share by a link"): shown to anyone who has the link, without
// signing in. Drive gives the files of a folder set to "anyone with the link" to MyMedia Free's API key
// (no account, so no place among the full door's 100). Read-only: albums, photos, videos, dates.

import { ChevronLeft, ChevronRight, Folder, Loader2, Play, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadConfig } from '../config'
import { useFormat } from '../i18n/format'
import { FOLDER_MIME } from '../lib/media'
import { LanguageSwitch } from './SignIn'

const API = 'https://www.googleapis.com/drive/v3'
const FIELDS = 'nextPageToken,files(id,name,mimeType,thumbnailLink,createdTime,properties,imageMediaMetadata(time))'

interface PubFile {
  id: string
  name: string
  mimeType: string
  thumbnailLink?: string
  createdTime?: string
  properties?: Record<string, string>
  imageMediaMetadata?: { time?: string }
}

class Gone extends Error {}

async function read<T>(path: string, key: string): Promise<T> {
  const r = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`)
  if (r.status === 404 || r.status === 403 || r.status === 401) throw new Gone(String(r.status))
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`)
  return (await r.json()) as T
}

/** Everything directly in a folder (every page). */
async function children(id: string, key: string): Promise<PubFile[]> {
  const out: PubFile[] = []
  let page: string | undefined
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
    const r = await read<{ files: PubFile[]; nextPageToken?: string }>(
      `/files?q=${q}&pageSize=1000&fields=${encodeURIComponent(FIELDS)}${page ? `&pageToken=${page}` : ''}`,
      key,
    )
    out.push(...r.files)
    page = r.nextPageToken
  } while (page)
  return out
}

const isFolder = (f: PubFile) => f.mimeType === FOLDER_MIME
const isMedia = (f: PubFile) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')
const isVideo = (f: PubFile) => f.mimeType.startsWith('video/')

/** The date the photo was taken, as MyMedia knows it (its public label), else the camera's, else the upload. */
function takenAt(f: PubFile): string {
  const own = f.properties?.mymedia_date_set ?? f.properties?.mymedia_taken
  if (own) return own
  const exif = f.imageMediaMetadata?.time?.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T')
  return exif ?? f.createdTime ?? ''
}

/** A size of Google's preview (the link ends with "=s220"); a public file's preview needs no account. */
const sized = (f: PubFile, px: number) =>
  f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+(-c)?$/, `=s${px}`) : `https://drive.google.com/thumbnail?id=${f.id}&sz=w${px}`

/** Several albums chosen together: the link's first page shows them side by side. */
const CHOSEN = '*'

/** The albums of a link of several (those still shared; one stopped since is left out). */
async function chosenAlbums(ids: string[], key: string): Promise<PubFile[]> {
  const got = await Promise.all(
    ids.map((id) =>
      read<PubFile>(`/files/${id}?fields=id,name,mimeType`, key).catch((e) => {
        if (e instanceof Gone) return null
        throw e
      }),
    ),
  )
  const albums = got.filter((f): f is PubFile => !!f)
  if (!albums.length) throw new Gone('404')
  return albums
}

export function PublicLibrary({ rootIds }: { rootIds: string[] }) {
  const rootId = rootIds.length > 1 ? CHOSEN : rootIds[0]
  const ids = rootIds.join(',')
  const { t } = useTranslation()
  const fmt = useFormat()
  const [key, setKey] = useState<string | null>(null)
  const [path, setPath] = useState<{ id: string; name: string }[]>([])
  const [files, setFiles] = useState<PubFile[] | null>(null)
  const [error, setError] = useState<'gone' | 'failed' | 'noKey' | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const here = path[path.length - 1]?.id ?? rootId

  useEffect(() => {
    loadConfig().then((c) => (c.googleApiKey ? setKey(c.googleApiKey) : setError('noKey')))
  }, [])

  // The library's name (its root folder).
  useEffect(() => {
    if (!key) return
    if (rootId === CHOSEN) {
      setPath([{ id: CHOSEN, name: t('publicLib.albums') }])
      document.title = `${t('publicLib.albums')} · MyMedia`
      return
    }
    read<{ name: string }>(`/files/${rootId}?fields=name`, key).then(
      (f) => {
        setPath([{ id: rootId, name: f.name }])
        document.title = `${f.name} · MyMedia`
      },
      (e) => setError(e instanceof Gone ? 'gone' : 'failed'),
    )
  }, [key, rootId, t])

  useEffect(() => {
    if (!key || !path.length) return
    let alive = true
    setFiles(null)
    setOpen(null)
    const listed = here === CHOSEN ? chosenAlbums(ids.split(','), key) : children(here, key)
    listed.then(
      (f) => alive && setFiles(f),
      (e) => alive && setError(e instanceof Gone ? 'gone' : 'failed'),
    )
    return () => {
      alive = false
    }
  }, [key, here, path.length, ids])

  const folders = (files ?? []).filter(isFolder).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const media = (files ?? []).filter(isMedia).sort((a, b) => takenAt(b).localeCompare(takenAt(a)))

  const step = useCallback((d: number) => setOpen((i) => (i === null ? null : Math.min(Math.max(i + d, 0), media.length - 1))), [media.length])
  useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      // Right-to-left pages: the arrow keys follow the reading direction.
      const rtl = document.dir === 'rtl'
      if (e.key === 'ArrowRight') step(rtl ? -1 : 1)
      if (e.key === 'ArrowLeft') step(rtl ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step])

  if (error) {
    return (
      <div className="center-screen">
        <div className="card">
          <img className="logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <h1>{t('app.name')}</h1>
          <p className="error-text">{t(error === 'gone' ? 'publicLib.gone' : 'publicLib.failed')}</p>
          <p>
            <a href="/">{t('publicLib.makeYours')}</a>
          </p>
          <LanguageSwitch />
        </div>
      </div>
    )
  }

  const shown = open === null ? null : media[open]

  return (
    <div className="pub">
      <header className="pub-head">
        <img className="pub-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <div className="pub-title">
          <strong>{path[0]?.name ?? t('app.name')}</strong>
          <span className="hint">{t('publicLib.readOnly')}</span>
        </div>
        <a className="btn" href="/">
          {t('publicLib.makeYours')}
        </a>
      </header>

      {path.length > 1 && (
        <nav className="pub-path">
          {path.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="hint"> › </span>}
              {i < path.length - 1 ? (
                <button className="btn" onClick={() => setPath(path.slice(0, i + 1))}>
                  {p.name}
                </button>
              ) : (
                <strong>{p.name}</strong>
              )}
            </span>
          ))}
        </nav>
      )}

      {!files ? (
        <p className="center-screen">
          <Loader2 className="spin" />
        </p>
      ) : (
        <>
          {folders.length > 0 && (
            <div className="pub-folders">
              {folders.map((f) => (
                <button key={f.id} className="btn pub-folder" onClick={() => setPath([...path, { id: f.id, name: f.name }])}>
                  <Folder size={18} /> <bdi>{f.name}</bdi>
                </button>
              ))}
            </div>
          )}
          {media.length > 0 && <p className="hint pub-count">{t('publicLib.count', { count: media.length })}</p>}
          <div className="pub-grid">
            {media.map((f, i) => (
              <button key={f.id} className="pub-thumb" onClick={() => setOpen(i)} title={fmt.date(takenAt(f) || undefined)}>
                <img loading="lazy" src={sized(f, 400)} alt={f.name} referrerPolicy="no-referrer" />
                {isVideo(f) && <Play className="pub-play" size={22} />}
              </button>
            ))}
          </div>
          {!folders.length && !media.length && <p className="hint pub-count">{t('publicLib.empty')}</p>}
        </>
      )}

      {shown && key && (
        <div className="pub-viewer" role="dialog" aria-label={shown.name}>
          <button className="pub-close btn" onClick={() => setOpen(null)} aria-label={t('common.close')}>
            <X size={20} />
          </button>
          {open! > 0 && (
            <button className="pub-nav pub-prev btn" onClick={() => step(-1)} aria-label={t('publicLib.prev')}>
              <ChevronLeft size={24} />
            </button>
          )}
          {isVideo(shown) ? (
            <video key={shown.id} src={`${API}/files/${shown.id}?alt=media&key=${encodeURIComponent(key)}`} controls autoPlay playsInline />
          ) : (
            <img key={shown.id} src={sized(shown, 2000)} alt={shown.name} referrerPolicy="no-referrer" />
          )}
          {open! < media.length - 1 && (
            <button className="pub-nav pub-next btn" onClick={() => step(1)} aria-label={t('publicLib.next')}>
              <ChevronRight size={24} />
            </button>
          )}
          <p className="pub-caption">
            <bdi>{shown.name}</bdi>
            {takenAt(shown) && <> · {fmt.date(takenAt(shown))}</>}
          </p>
        </div>
      )}
    </div>
  )
}
