import { ArrowRight, Check, FileArchive, FolderOpen, ImagePlus, Loader2, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extractFiles, FacebookFormatError, readFacebookZip, type FacebookExport } from '../import/facebook'
import { findReplacements } from '../import/replace'
import { loadThumb } from '../sync/thumbs'
import { analyze, cancelImport, mediaFiles, runImport, withFacebookPosts, type ImportItem, type ImportOutcome } from '../import/importer'
import { speciesInText } from '../lib/katia'
import { importSourceName } from '../lib/provenance'
import { useFormat } from '../i18n/format'
import { placementOf } from '../lib/tree'
import { auth } from '../auth/google'
import { useApp } from '../store'
import { AlbumSelect } from './AlbumSelect'
import { Modal } from './Dialog'
import type { Library } from './useLibrary'

interface Props {
  lib: Library
  /** Initial destination folder (album, category or root). */
  destId: string
  /** Files already chosen (received from the Share menu). */
  initialFiles?: File[]
  onClose: () => void
}

const RECENT_KEY = 'mymedia.recentDestinations'

function recentDestinations(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function rememberDestination(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentDestinations().filter((x) => x !== id)].slice(0, 6)))
  } catch {
    // a convenience only
  }
}

function FilePreview({ item }: { item: ImportItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (item.type !== 'photo' || /hei[cf]/i.test(item.mimeType)) return
    const u = URL.createObjectURL(item.file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [item])
  return (
    <span className="list-thumb">
      {url ? <img src={url} alt="" loading="lazy" /> : item.type === 'video' ? <Play size={18} className="flip-rtl" style={{ margin: 11 }} /> : null}
    </span>
  )
}

/** The photo in Drive that a file of the ZIP replaces. */
function ReplacedThumb({ lib, id }: { lib: Library; id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const rec = useMemo(() => lib.items.find((i) => i.rec.id === id)?.rec, [lib.items, id])
  useEffect(() => {
    if (rec) void loadThumb(rec, () => true).then(setUrl)
  }, [rec])
  return (
    <>
      <span className="list-thumb">{url && <img src={url} alt="" loading="lazy" />}</span>
      <ArrowRight size={14} className="flip-rtl" />
    </>
  )
}

/** "Add photos/videos": choose files or a folder, check dates and sizes, upload. */
export function ImportDialog({ lib, destId: initialDest, initialFiles, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const [destId, setDestId] = useState(initialDest)
  const [phase, setPhase] = useState<'pick' | 'zip' | 'groups' | 'analyze' | 'match' | 'choose' | 'upload' | 'done'>('pick')
  const [fb, setFb] = useState<FacebookExport | null>(null)
  const [fbGroups, setFbGroups] = useState<Set<string>>(new Set())
  const [zipName, setZipName] = useState<string | undefined>()
  const [zipError, setZipError] = useState<string | null>(null)
  const [analyzed, setAnalyzed] = useState({ done: 0, total: 0 })
  const [items, setItems] = useState<ImportItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [compress, setCompress] = useState(true)
  const [keepFolders, setKeepFolders] = useState(true)
  const [outcomes, setOutcomes] = useState<Record<string, ImportOutcome>>({})
  const [result, setResult] = useState<{ count: number; before: number; after: number } | null>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const canPickFolder = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent)

  const nameOf = (id: string) => {
    if (id === rootId) return useApp.getState().settings.rootName
    const p = placementOf(id, lib.folders, rootId)
    return [p.category, p.album].filter(Boolean).join(' / ')
  }
  const destName = nameOf(destId)
  const recent = recentDestinations().filter((id) => id !== destId && (id === rootId || lib.folders.has(id)))

  useEffect(() => {
    if (initialFiles?.length) void onFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onFiles(list: FileList | File[] | null, posts?: FacebookExport['posts']) {
    const files = mediaFiles([...(list ?? [])])
    if (!files.length) return
    setPhase('analyze')
    setAnalyzed({ done: 0, total: files.length })
    let result = await analyze(files, (done) => setAnalyzed({ done, total: files.length }))
    if (posts) {
      result = await withFacebookPosts(result, posts)
      setPhase('match')
      setAnalyzed({ done: 0, total: 0 })
      result = await findReplacements(result, (done, total) => setAnalyzed({ done, total }))
    }
    setItems(result)
    setChecked(new Set(result.filter((i) => !i.duplicate).map((i) => i.key)))
    setPhase('choose')
  }

  async function onZip(file: File | undefined) {
    if (!file) return
    setZipError(null)
    setPhase('zip')
    try {
      const read = await readFacebookZip(file)
      const groups = [...read.groups.entries()].sort((a, b) => b[1] - a[1])
      setFb(read)
      setZipName(file.name)
      setFbGroups(new Set(groups.slice(0, 1).map(([g]) => g)))
      setPhase('groups')
    } catch (e) {
      console.error('[MyMedia] Facebook ZIP not read', e)
      setZipError(e instanceof FacebookFormatError ? t('facebook.notExport') : t('facebook.unreadable'))
      setPhase('pick')
    }
  }

  async function fromGroups() {
    if (!fb) return
    setPhase('analyze')
    const files = await extractFiles(fb, fbGroups, (done, total) => setAnalyzed({ done, total }))
    await onFiles(files, fb.posts)
  }

  // Facebook posts: the species named in the text, when it is an album of the destination.
  const albumNames = useMemo(() => [...lib.folders.values()].filter((f) => f.parentId === destId).map((f) => f.name), [lib.folders, destId])
  const speciesOf = (i: ImportItem) => (i.extra ? speciesInText(i.extra.description ?? null, albumNames) : null)

  const selected = items.filter((i) => checked.has(i.key))
  const sizeBefore = selected.reduce((n, i) => n + i.file.size, 0)
  const sizeAfter = selected.reduce((n, i) => n + (compress && i.estimate !== null ? i.estimate : i.file.size), 0)
  const hasFolders = !fb && items.some((i) => i.relDir.length > 0)
  const duplicates = items.filter((i) => i.duplicate).length
  const replacements = items.filter((i) => i.replaces).length

  async function start() {
    rememberDestination(destId)
    auth.renewBefore(Math.max(10, selected.length / 10) * 60_000)
    setPhase('upload')
    const toSend = fb
      ? selected.map((i) => {
          const species = speciesOf(i)
          return species ? { ...i, relDir: [species], extra: { ...i.extra, species } } : i
        })
      : selected
    const r = await runImport(toSend, destId, {
      compress,
      keepFolders: keepFolders || !!fb,
      from: importSourceName({ zipName: fb ? zipName : undefined, relDirs: items.map((i) => i.relDir) }),
    }, (key, o) => setOutcomes((prev) => ({ ...prev, [key]: o })))
    setResult(r)
    setPhase('done')
  }

  const toggle = (key: string) =>
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const status = (i: ImportItem) => {
    const o = outcomes[i.key]
    if (phase === 'choose' || !checked.has(i.key)) {
      if (i.duplicate) return <span className="tag warn">{t(i.sameLook ? 'import.duplicateLook' : 'import.duplicate')}</span>
      if (i.replaces)
        return (
          <>
            <span className="tag">{t(i.replaces.by === 'name' ? 'facebook.replacesByName' : 'facebook.replacesByLook')}</span>
            <br />
            {fmt.bytes(i.replaces.size)} → {fmt.bytes(i.file.size)}
          </>
        )
      return compress && i.estimate !== null ? (
        <>
          {fmt.bytes(i.file.size)} → ≈ {fmt.bytes(i.estimate)}
        </>
      ) : (
        fmt.bytes(i.file.size)
      )
    }
    if (!o || o.status === 'waiting') return <span className="hint">{t('compress.waiting')}</span>
    if (o.status === 'compressing')
      return (
        <>
          <Loader2 size={14} className="spin" /> {t('import.compressing')} {o.progress ? fmt.percent(o.progress) : ''}
        </>
      )
    if (o.status === 'uploading')
      return (
        <>
          <Loader2 size={14} className="spin" /> {t('import.uploading')} {fmt.percent(o.progress)}
        </>
      )
    if (o.status === 'done')
      return (
        <span className="ok-text">
          <Check size={14} /> {fmt.bytes(o.size)}
        </span>
      )
    return (
      <span className="error-text">
        <X size={14} /> {t('compress.failed')}
      </span>
    )
  }

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.takenAt.localeCompare(b.takenAt)), [items])

  return (
    <Modal wide title={t('import.title')} onClose={phase === 'upload' ? () => undefined : onClose}>
      <div className="row" style={{ marginBlockEnd: 10 }}>
        <span>{t('import.to')}</span>
        <strong>
          <bdi>{destName}</bdi>
        </strong>
        {(phase === 'pick' || phase === 'groups' || phase === 'choose') && (
          <AlbumSelect
            categories={lib.categories}
            placeholder={t('import.changeDest')}
            onChoose={setDestId}
            exclude={destId}
          />
        )}
      </div>

      {(phase === 'pick' || phase === 'groups' || phase === 'choose') && recent.length > 0 && (
        <div className="chip-list">
          {recent.map((id) => (
            <button key={id} className="chip-btn" onClick={() => setDestId(id)}>
              <bdi>{nameOf(id)}</bdi>
            </button>
          ))}
        </div>
      )}

      {phase === 'pick' && (
        <>
          <p>{t('import.intro')}</p>
          <div className="row">
            <button className="btn primary" onClick={() => filesInput.current?.click()}>
              <ImagePlus size={18} /> {t('import.chooseFiles')}
            </button>
            {canPickFolder && (
              <button className="btn" onClick={() => folderInput.current?.click()}>
                <FolderOpen size={18} /> {t('import.chooseFolder')}
              </button>
            )}
            <button className="btn" onClick={() => zipInput.current?.click()}>
              <FileArchive size={18} /> {t('facebook.choose')}
            </button>
          </div>
          {zipError && <p className="error-text">{zipError}</p>}
          <p className="hint">{t('import.dateHint')}</p>
          <p className="hint">{t('facebook.hint')}</p>
          <input ref={zipInput} type="file" hidden accept=".zip,application/zip" onChange={(e) => void onZip(e.target.files?.[0])} />
          <input ref={filesInput} type="file" multiple hidden accept="image/*,video/*,.heic,.heif,.mov" onChange={(e) => onFiles(e.target.files)} />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => onFiles(e.target.files)}
          />
        </>
      )}

      {phase === 'zip' && (
        <p>
          <Loader2 size={16} className="spin" /> {t('facebook.reading')}
        </p>
      )}

      {phase === 'groups' && fb && (
        <>
          <p>{t('facebook.chooseGroups')}</p>
          <ul className="compress-list">
            {[...fb.groups.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([g, n]) => (
                <li key={g} className={fbGroups.has(g) ? '' : 'off'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={fbGroups.has(g)}
                      onChange={() =>
                        setFbGroups((cur) => {
                          const next = new Set(cur)
                          if (next.has(g)) next.delete(g)
                          else next.add(g)
                          return next
                        })
                      }
                    />
                    <span className="name">
                      <bdi>{g || t('facebook.noGroup')}</bdi>
                    </span>
                  </label>
                  <span className="sizes">{t('facebook.photos', { count: n })}</span>
                </li>
              ))}
          </ul>
          <p className="hint">{t('facebook.speciesHint')}</p>
        </>
      )}

      {phase === 'match' && (
        <>
          <p>{t('facebook.matching', { done: analyzed.done, total: analyzed.total })}</p>
          <progress max={analyzed.total || 1} value={analyzed.done} style={{ inlineSize: '100%' }} />
        </>
      )}

      {phase === 'analyze' && (
        <>
          <p>{t('import.analyzing', { done: analyzed.done, total: analyzed.total })}</p>
          <progress max={analyzed.total} value={analyzed.done} style={{ inlineSize: '100%' }} />
        </>
      )}

      {(phase === 'choose' || phase === 'upload' || phase === 'done') && (
        <>
          <ul className="compress-list">
            {sortedItems.map((i) => (
              <li key={i.key} className={checked.has(i.key) ? '' : 'off'}>
                <label>
                  <input type="checkbox" checked={checked.has(i.key)} disabled={phase !== 'choose'} onChange={() => toggle(i.key)} />
                  {i.replaces && <ReplacedThumb lib={lib} id={i.replaces.id} />}
                  <FilePreview item={i} />
                  <span className="name" title={i.file.name}>
                    <bdi>{i.file.name}</bdi>
                    <br />
                    <span className="hint">
                      {fmt.dateTime(i.takenAt)} · {t(`import.source.${i.dateSource}`)}
                      {i.relDir.length > 0 && keepFolders && !fb && (
                        <>
                          {' · '}
                          <bdi>{i.relDir.join(' / ')}</bdi>
                        </>
                      )}
                      {fb && speciesOf(i) && (
                        <>
                          {' · '}
                          <bdi>{speciesOf(i)}</bdi>
                        </>
                      )}
                      {i.extra?.description && (
                        <>
                          <br />
                          <bdi className="clamp-1">{i.extra.description}</bdi>
                        </>
                      )}
                    </span>
                  </span>
                </label>
                <span className="sizes">{status(i)}</span>
              </li>
            ))}
          </ul>
          {phase === 'choose' && (
            <>
              <label className="radio-row">
                <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
                {t('import.compress')}
              </label>
              {hasFolders && (
                <label className="radio-row">
                  <input type="checkbox" checked={keepFolders} onChange={(e) => setKeepFolders(e.target.checked)} />
                  {t('import.keepFolders')}
                </label>
              )}
              {duplicates > 0 && <p className="hint">{t('import.duplicatesHint', { count: duplicates })}</p>}
              {replacements > 0 && <p className="hint">{t('facebook.replaceHint', { count: replacements })}</p>}
              <p>
                <strong>
                  {t('compress.selection', { count: selected.length })}: {fmt.bytes(sizeBefore)}
                  {compress && sizeAfter < sizeBefore ? <> → ≈ {fmt.bytes(sizeAfter)}</> : null}
                </strong>
              </p>
            </>
          )}
          {phase === 'done' && result && (
            <p>
              <strong>
                {t('import.done', { count: result.count, before: fmt.bytes(result.before), after: fmt.bytes(result.after) })}
              </strong>
            </p>
          )}
        </>
      )}

      <div className="actions">
        {phase === 'choose' && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!selected.length} onClick={start}>
              {t('import.uploadN', { count: selected.length })}
            </button>
          </>
        )}
        {phase === 'groups' && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!fbGroups.size} onClick={() => void fromGroups()}>
              {t('common.next')}
            </button>
          </>
        )}
        {phase === 'upload' && (
          <button className="btn" onClick={cancelImport}>
            {t('common.cancel')}
          </button>
        )}
        {(phase === 'done' || phase === 'pick') && (
          <button className={`btn ${phase === 'done' ? 'primary' : ''}`} onClick={onClose}>
            {phase === 'done' ? t('common.ok') : t('common.cancel')}
          </button>
        )}
      </div>
    </Modal>
  )
}
