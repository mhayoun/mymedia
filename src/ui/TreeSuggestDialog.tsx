import { Check, Download, FolderOpen, FolderTree, Library as LibraryIcon, Loader2, RefreshCw, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canRead, canWalkFolders, filesBelow, pickAndWalk, walkFolder, type FsDir, type WalkedFolder } from '../import/folderWalk'
import { mediaFiles } from '../import/importer'
import { importStats, keepAnalysis, keptAnalysis, saveTrack, useImportTrack, type ImportTrack } from '../import/importTrack'
import { useFormat } from '../i18n/format'
import { treeText } from '../lib/folderNames'
import { estimateImport, planAlbums, sumSizes, type PlanAlbum, type WalkedFile } from '../lib/importPlan'
import { nameHasYear, yearFirst } from '../lib/albumYear'
import { CATEGORY_KEYS, type CategoryKey } from '../lib/proposeCategories'
import { mediaTypeOf } from '../lib/media'
import { useApp } from '../store'
import { createCategories, newFolder, putIntoCategories } from '../sync/folders'
import { CategoryProposal, useCategoryProposal, type AlbumChecks, type CategoryChoice, type ProposalAlbum } from './CategoryProposal'
import { Modal } from './Dialog'
import type { AlbumTarget } from './ImportDialog'
import { ImportEstimate, useApproxDuration } from './ImportEstimate'
import type { Library } from './useLibrary'

type Source = 'computer' | 'library'
const NONE: ProposalAlbum[] = []
const NO_CHOICE: CategoryChoice = { moved: {}, labels: {}, off: [] }

/** The categories without albums (folders of photos put in the root), as albums to sort. */
export function loneFolders(lib: Library) {
  return lib.categories.filter((c) => c.children.length === 0 && c.count > 0)
}

/** A folder MyMedia read: its name, every folder below it, its photos and videos (names and sizes), and how to get them. */
interface ReadFolder {
  name: string
  dirs: string[][]
  files: WalkedFile[]
  /** Walked by MyMedia (Chrome / Edge): the files are read only at import; kept to go on another day. */
  handle?: FsDir
  /** Chosen with the browser's folder window (other browsers): the files themselves. */
  picked?: File[]
}

/** Above this (what is left to import), the folder is imported album by album, not at once. */
const BIG_FILES = 2000
const BIG_BYTES = 5e9
/** Albums ticked whose import would take longer: keep the tab open and the computer on. */
const LONG_MS = 3_600_000
/** "Put the ticked albums into": no change (each keeps its proposed category). */
const OWN = '__own'
const YEAR_KEY = 'mymedia.yearFirst'

/** "Year first in the albums' names", as chosen last time (on by default). */
function savedYearFirst(): boolean {
  try {
    return localStorage.getItem(YEAR_KEY) !== '0'
  } catch {
    return true
  }
}

/** Folders of the files' paths (a folder without photos is not seen this way). */
function dirsOfPaths(paths: string[]): string[][] {
  const seen = new Map<string, string[]>()
  for (const p of paths) {
    const parts = p.split('/').slice(1, -1)
    for (let d = 1; d <= parts.length; d++) seen.set(parts.slice(0, d).join('/'), parts.slice(0, d))
  }
  return [...seen.values()]
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

/** Whether a MyMedia album is this folder's: its name, or its name with the year put first ("2016 mariageAvishai"). */
function isAlbumOf(albumName: string, folder: string): boolean {
  if (same(albumName, folder) || same(albumName, yearFirst(folder))) return true
  const m = /^(\d{4}) (.+)$/.exec(albumName.trim())
  return !!m && same(m[2], folder.trim())
}

interface Props {
  lib: Library
  /** The chosen folder imported into MyMedia with the categories checked here. */
  onImport: (files: File[], categories: CategoryChoice) => void
  /** Albums of the folder (one, or several ticked): sent one after the other, each into its category; back here afterwards. */
  onImportAlbums: (files: File[], albums: AlbumTarget[], opts: { diskRoot: string; yearFirst: boolean }) => void
  onClose: () => void
}

/**
 * "Tree suggestion": MyMedia reads only the names of the folders and sub-folders (of a folder of the
 * computer, or of MyMedia's albums without a category) and proposes categories. A folder read with
 * Chrome / Edge is kept on this device: read again another day, it shows what is left to import (folders
 * renamed meanwhile are sorted again), each album with its size and an Import button.
 */
export function TreeSuggestDialog(props: Props) {
  const track = useImportTrack()
  // The corrections made by hand come back with the folder followed: wait for it.
  if (track === undefined) return null
  return <TreeSuggest {...props} track={track} />
}

function TreeSuggest({ lib, onImport, onImportAlbums, onClose, track }: Props & { track: ImportTrack | null }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const duration = useApproxDuration()
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [yearOn, setYearOn] = useState(savedYearFirst)
  const rootId = useApp((s) => s.rootId)!
  const walks = canWalkFolders()
  const canPickFolder = walks || (typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent))
  const lone = useMemo(() => loneFolders(lib), [lib])
  // Back from an album's import: the analysis is still there (reading the folder again takes minutes).
  const [folder, setFolder] = useState<ReadFolder | null>(() => {
    const kept = keptAnalysis<ReadFolder>()
    return kept && track && kept.name === track.rootName ? kept : null
  })
  const [source, setSource] = useState<Source | null>(folder ? 'computer' : null)
  const [reading, setReading] = useState<{ dirs: number; files: number } | null>(null)
  const [explain, setExplain] = useState(false)
  const [preparing, setPreparing] = useState<{ album: string | null; files: number; total?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null)
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null)
  const [created, setCreated] = useState<{ count: number; existing: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)

  const plan = useMemo(() => (folder ? planAlbums(folder.files) : null), [folder])
  const fromComputer = useMemo(() => plan?.albums.map((a) => ({ name: a.name, count: a.files })) ?? NONE, [plan])
  const fromLibrary = useMemo(() => lone.map((f) => ({ name: f.name, count: f.count })).sort((a, b) => a.name.localeCompare(b.name)), [lone])
  const albums = source === 'computer' ? fromComputer : source === 'library' ? fromLibrary : NONE
  const followed = !!folder?.handle && !!track && track.rootName === folder.name
  // The corrections made by hand on the folder followed (a folder read again finds them).
  const proposal = useCategoryProposal(albums, track?.choice)
  const tree = useMemo(() => (folder ? treeText(folder.name, folder.dirs) : ''), [folder])

  // The corrections made by hand, kept for the next analysis of the same folder.
  const trackRef = useRef(track)
  trackRef.current = track
  useEffect(() => {
    const tr = trackRef.current
    if (followed && tr && tr.choice !== proposal.choice) void saveTrack({ ...tr, choice: proposal.choice })
  }, [followed, proposal.choice])

  /**
   * Files of an album already in MyMedia: as its import said, or as MyMedia shows. An album since removed
   * from MyMedia is to import again, whatever its import said.
   */
  const inMyMedia = (a: PlanAlbum) => {
    const rec = followed ? track!.imported[a.name] : undefined
    const category = rec ? rec.category : proposal.categoryOf(a.name)
    const parent = category ? lib.categories.find((c) => same(c.name, category)) : null
    const siblings = category ? (parent?.children ?? []) : lib.categories
    const album = siblings.find((c) => isAlbumOf(c.name, a.name))
    // While MyMedia's albums are not loaded yet, the import's word.
    if (!album) return lib.ready ? { files: 0, failed: 0, category } : { files: rec?.files ?? 0, failed: rec?.failed ?? 0, category }
    return { files: Math.max(rec?.files ?? 0, album.count), failed: rec?.failed ?? 0, category }
  }
  const status = new Map((plan?.albums ?? []).map((a) => [a.name, inMyMedia(a)]))
  const isDone = (a: PlanAlbum) => (status.get(a.name)?.files ?? 0) >= a.files
  const doneAlbums = (plan?.albums ?? []).filter(isDone)
  const leftAlbums = (plan?.albums ?? []).filter((a) => !isDone(a))
  const left = sumSizes(leftAlbums)
  const big = left.files > BIG_FILES || left.bytes > BIG_BYTES
  const doneNames = new Set(doneAlbums.map((a) => a.name))
  // Albums ticked to import together (those since imported are left out).
  const tickedAlbums = leftAlbums.filter((a) => ticked.has(a.name))
  const tickedSizes = sumSizes(tickedAlbums)
  const tickedEstimate = estimateImport(tickedSizes, true, importStats())
  const checks: AlbumChecks = {
    isOn: (name) => ticked.has(name),
    set: (names, on) =>
      setTicked((cur) => {
        const n = new Set(cur)
        for (const name of names) if (on) n.add(name)
        else n.delete(name)
        return n
      }),
  }
  /** The ticked albums into one category (or none): as if each one's list were changed by hand. */
  function putTicked(value: string) {
    if (value === OWN) return
    const key = value ? (value as CategoryKey) : null
    proposal.setChoice((c) => ({
      ...c,
      moved: { ...c.moved, ...Object.fromEntries(tickedAlbums.map((a) => [a.name, key])) },
      // A category unticked comes back when albums are put in it.
      off: key ? c.off.filter((k) => k !== key) : c.off,
    }))
  }

  const moves = lone.flatMap((f) => {
    const category = proposal.categoryOf(f.name)
    // An album already named like its category stays: it is that category.
    return category && !same(category.trim(), f.name.trim()) ? [{ id: f.id, category }] : []
  })
  /** The categories kept for the albums left to import. */
  const kept = [
    ...new Set(
      albums
        .filter((a) => !doneNames.has(a.name))
        .map((a) => proposal.categoryOf(a.name))
        .filter((c): c is string => !!c),
    ),
  ]

  /** A folder read: shown, and followed on this device (the same folder again keeps what was done). */
  async function analysed(w: WalkedFolder) {
    const f: ReadFolder = { name: w.name, dirs: w.dirs, files: w.files, handle: w.handle }
    const count = planAlbums(w.files).albums.length
    const sameFolder = !!track && ((await track.handle.isSameEntry?.(w.handle).catch(() => false)) ?? track.rootName === w.name)
    const analysedAt = new Date().toISOString()
    if (sameFolder && track) await saveTrack({ ...track, rootName: w.name, handle: w.handle, analysedAt, albums: count })
    else {
      proposal.setChoice(NO_CHOICE)
      await saveTrack({ rootName: w.name, handle: w.handle, analysedAt, albums: count, choice: NO_CHOICE, imported: {} })
    }
    keepAnalysis(f)
    setFolder(f)
    setSource('computer')
  }

  async function readFolder() {
    setExplain(false)
    if (!walks) return folderInput.current?.click()
    setError(null)
    setReading({ dirs: 0, files: 0 })
    try {
      const w = await pickAndWalk((dirs, files) => setReading({ dirs, files }))
      if (w) await analysed(w)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    setReading(null)
  }

  /** The folder followed, read again (renamed folders sorted again, what was imported apart). */
  async function readAgain() {
    if (!track) return
    setError(null)
    setReading({ dirs: 0, files: 0 })
    try {
      if (!(await canRead(track.handle))) throw new Error(t('treeSuggest.noAccess', { name: track.rootName }))
      await analysed(await walkFolder(track.handle, (dirs, files) => setReading({ dirs, files })))
    } catch (e) {
      setError((e as Error).name === 'NotFoundError' ? t('treeSuggest.notFound', { name: track.rootName }) : t('errors.generic', { message: (e as Error).message }))
    }
    setReading(null)
  }

  function pickedFiles(list: FileList | null) {
    const all = [...(list ?? [])]
    if (!all.length) return
    const picked = mediaFiles(all)
    setFolder({
      name: all[0].webkitRelativePath.split('/')[0] ?? '',
      dirs: dirsOfPaths(all.map((f) => f.webkitRelativePath)),
      files: picked.map((f) => {
        const parts = f.webkitRelativePath.split('/')
        return { dirs: parts.slice(1, -1), name: f.name, size: f.size, type: mediaTypeOf(f.type, f.name) ?? 'document' }
      }),
      picked,
    })
    setSource('computer')
  }

  async function importFolder() {
    if (!folder) return
    if (folder.picked) return onImport(folder.picked, proposal.choice)
    if (!folder.handle) return
    setPreparing({ album: null, files: 0 })
    try {
      onImport(await filesBelow(folder.handle, [[]], folder.name, (files) => setPreparing({ album: null, files })), proposal.choice)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setPreparing(null)
    }
  }

  /** One album: as several ticked (its files read, its category made if needed, then the import). */
  const importAlbum = (a: PlanAlbum) => importAlbums([a], a.name)

  /** Albums: their files read, their categories made if needed, then one import, album after album. */
  async function importAlbums(list: PlanAlbum[], one: string | null) {
    if (!folder?.handle || !list.length) return
    setError(null)
    const total = sumSizes(list).files
    setPreparing({ album: one, files: 0, total })
    try {
      if (!(await canRead(folder.handle))) throw new Error(t('treeSuggest.noAccess', { name: folder.name }))
      const files: File[] = []
      const targets: AlbumTarget[] = []
      const made = new Map<string, string>()
      for (const a of list) {
        const before = files.length
        files.push(...(await filesBelow(folder.handle, a.dirs, a.name, (n) => setPreparing({ album: one, files: before + n, total }))))
        const category = proposal.categoryOf(a.name)
        let destId = rootId
        if (category) {
          const key = category.toLocaleLowerCase()
          destId = made.get(key) ?? lib.categories.find((c) => same(c.name, category))?.id ?? (await newFolder(category, rootId)).id
          made.set(key, destId)
        }
        targets.push({ name: a.name, destId, category })
      }
      if (!one) setTicked(new Set())
      try {
        localStorage.setItem(YEAR_KEY, yearOn ? '1' : '0')
      } catch {
        // a convenience only
      }
      onImportAlbums(files, targets, { diskRoot: folder.name, yearFirst: yearOn })
    } catch (e) {
      setError((e as Error).name === 'NotFoundError' ? t('treeSuggest.notFound', { name: folder.name }) : t('errors.generic', { message: (e as Error).message }))
      setPreparing(null)
    }
  }

  async function createOnly() {
    setCreating(true)
    setError(null)
    try {
      setCreated(await createCategories(kept))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    setCreating(false)
  }

  function downloadTree() {
    const url = URL.createObjectURL(new Blob([tree], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'arbo.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function sortLibrary() {
    setProgress({ done: 0, failed: 0, total: moves.length })
    setResult(await putIntoCategories(moves, (done, failed) => setProgress({ done, failed, total: moves.length })))
  }

  /** An album's line: its size, and what was imported of it or its Import button. */
  const albumExtra = (p: ProposalAlbum) => {
    const a = plan?.albums.find((x) => x.name === p.name)
    if (!a) return null
    const st = status.get(a.name)
    return (
      <span className="album-extra">
        {yearOn && folder?.handle && yearFirst(a.name) !== a.name.trim() && (
          <span className="hint" title={t('treeSuggest.newName')}>
            → <bdi>{yearFirst(a.name)}</bdi>
          </span>
        )}
        {yearOn && folder?.handle && !nameHasYear(a.name) && <span className="hint">{t('treeSuggest.photosYear')}</span>}
        <span className="hint">{fmt.bytes(a.bytes)}</span>
        {st && st.files > 0 && <span className="hint">{t('treeSuggest.partial', { done: fmt.number(st.files), total: fmt.number(a.files) })}</span>}
        {st && st.failed > 0 && <span className="error-text">{t('treeSuggest.failed', { count: st.failed })}</span>}
        {folder?.handle &&
          (preparing?.album === a.name ? (
            <span className="hint">
              <Loader2 size={14} className="spin" /> {fmt.number(preparing.files)}
            </span>
          ) : (
            <button className="btn small" disabled={busy} onClick={() => void importAlbum(a)}>
              <Upload size={14} /> {t('treeSuggest.importAlbum')}
            </button>
          ))}
      </span>
    )
  }

  const busy = (progress !== null && result === null) || reading !== null || preparing !== null || creating
  // Once the folder is read, what is really in MyMedia (albums removed since are to do again).
  const importedCount = plan && followed ? doneAlbums.length : track ? Object.values(track.imported).filter((r) => r.files > 0 && r.failed === 0).length : 0
  return (
    <Modal wide title={t('treeSuggest.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        {!progress && (
          <>
            <div className="tree-suggest-intro">
              <FolderTree size={28} />
              <div>
                <p>
                  <span className="tag auto">{t('treeSuggest.new')}</span> <strong>{t('treeSuggest.lead')}</strong>
                </p>
                <p className="hint">{t('treeSuggest.privacy')}</p>
              </div>
            </div>

            {track && walks && (
              <div className="tree-followed">
                <p>
                  {t('treeSuggest.lastAnalysis', { name: track.rootName, date: fmt.date(track.analysedAt) })}
                  {' — '}
                  {t('treeSuggest.importedOf', { count: importedCount, total: track.albums })}
                </p>
                <button className="btn primary" disabled={busy} onClick={() => void readAgain()}>
                  <RefreshCw size={16} /> {t('treeSuggest.readAgain')}
                </button>
              </div>
            )}

            <div className="tree-suggest-sources">
              {canPickFolder && (
                <button className={`btn ${source === 'computer' && !followed ? 'primary' : ''}`} disabled={busy} onClick={() => setExplain(true)}>
                  <FolderOpen size={18} /> {t(track && walks ? 'treeSuggest.otherFolder' : 'treeSuggest.fromComputer')}
                </button>
              )}
              {lone.length >= 2 && (
                <button className={`btn ${source === 'library' ? 'primary' : ''}`} disabled={busy} onClick={() => setSource('library')}>
                  <LibraryIcon size={18} /> {t('treeSuggest.fromLibrary', { count: lone.length })}
                </button>
              )}
            </div>
            <input
              ref={folderInput}
              type="file"
              hidden
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                pickedFiles(e.target.files)
                e.target.value = ''
              }}
            />
            {explain && (
              <div className="browser-warning" role="alertdialog" aria-labelledby="browser-warning-title">
                <p id="browser-warning-title">
                  <strong>{t(walks ? 'treeSuggest.warnTitle' : 'treeSuggest.warnTitleUpload')}</strong>
                </p>
                <p>{t(walks ? 'treeSuggest.warnText' : 'treeSuggest.warnTextUpload')}</p>
                {track && walks && <p className="hint">{t('treeSuggest.otherFolderHint', { name: track.rootName })}</p>}
                <div className="row">
                  <button className="btn" onClick={() => setExplain(false)}>
                    {t('common.cancel')}
                  </button>
                  <button className="btn primary" autoFocus onClick={() => void readFolder()}>
                    {t('treeSuggest.warnContinue')}
                  </button>
                </div>
              </div>
            )}
            {canPickFolder && !source && !reading && !explain && !track && <p className="hint">{t(walks ? 'treeSuggest.computerHint' : 'treeSuggest.computerHintUpload')}</p>}
            {!canPickFolder && !source && <p className="hint">{t('treeSuggest.computerOnly')}</p>}

            {reading && (
              <p aria-live="polite">
                <Loader2 size={16} className="spin" /> {t('treeSuggest.reading', { dirs: fmt.number(reading.dirs), files: fmt.number(reading.files) })}
              </p>
            )}
            {error && <p className="error-text">{error}</p>}

            {source === 'computer' && folder && plan && !reading && (
              <>
                <p>
                  <strong>
                    <bdi>{folder.name}</bdi>
                  </strong>
                  {' — '}
                  {t('treeSuggest.readDone', { dirs: fmt.number(folder.dirs.length), files: fmt.number(folder.files.length), count: plan.albums.length })}
                </p>
                <details className="tree-read">
                  <summary>{t('treeSuggest.showTree', { count: folder.dirs.length })}</summary>
                  <pre dir="auto">{tree}</pre>
                  <button className="btn ghost" onClick={downloadTree}>
                    <Download size={16} /> {t('treeSuggest.downloadTree')}
                  </button>
                </details>
                {leftAlbums.length > 0 ? (
                  <ImportEstimate
                    sizes={left}
                    label={
                      doneAlbums.length
                        ? t('treeSuggest.left', { count: leftAlbums.length, done: doneAlbums.length, files: fmt.number(left.files), size: fmt.bytes(left.bytes) })
                        : undefined
                    }
                  />
                ) : (
                  <p className="ok-text">
                    <Check size={16} /> {t('treeSuggest.allDone', { count: doneAlbums.length })}
                  </p>
                )}
                {plan.loose.files > 0 && (
                  <details className="tree-loose">
                    <summary className="hint">{t('treeSuggest.loose', { count: plan.loose.files })}</summary>
                    <ul>
                      {plan.looseDirs.map((l) => (
                        <li key={l.path.join('/')}>
                          <bdi>{[folder.name, ...l.path].join(' / ')}</bdi>
                          <span className="hint"> — {t(l.camera ? 'treeSuggest.looseCamera' : 'treeSuggest.looseHere', { count: l.files })}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {folder.handle && leftAlbums.length > 0 && <p className="hint">{t('treeSuggest.renameHint')}</p>}
                {big && !folder.handle && <p className="hint">{t('treeSuggest.bigNoTrack')}</p>}
              </>
            )}
            {source === 'library' && <p>{t('treeSuggest.libraryIntro', { count: lone.length })}</p>}
            {source === 'computer' && folder?.handle && leftAlbums.length > 0 && !reading && (
              <label className="radio-row">
                <input type="checkbox" checked={yearOn} onChange={(e) => setYearOn(e.target.checked)} />
                {t('import.yearFirst')}
              </label>
            )}
            {source && albums.length > 0 && !reading && (source === 'library' || leftAlbums.length > 0) && (
              <CategoryProposal
                state={proposal}
                show={source === 'computer' ? (name) => !doneNames.has(name) : undefined}
                extra={source === 'computer' ? albumExtra : undefined}
                checks={source === 'computer' && folder?.handle ? checks : undefined}
              />
            )}
            {source === 'computer' && doneAlbums.length > 0 && !reading && (
              <details className="tree-done">
                <summary className="ok-text">
                  <Check size={14} /> {t('treeSuggest.doneAlbums', { count: doneAlbums.length })}
                </summary>
                <ul>
                  {doneAlbums.map((a) => (
                    <li key={a.name}>
                      <bdi>{a.name}</bdi>
                      <span className="hint">
                        {' — '}
                        <bdi>{status.get(a.name)?.category ?? t('autoCategories.none')}</bdi> · {t('treeSuggest.albumSize', { count: a.files, files: fmt.number(a.files), size: fmt.bytes(a.bytes) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {source === 'computer' && folder && albums.length === 0 && !reading && <p className="hint">{t('autoCategories.noFolders')}</p>}
            {created && (
              <p className="ok-text" aria-live="polite">
                {t('treeSuggest.created', { count: created.count })}
                {created.existing > 0 && <> {t('treeSuggest.existing', { count: created.existing })}</>}
              </p>
            )}
            {preparing && preparing.album === null && (
              <p aria-live="polite">
                <Loader2 size={16} className="spin" /> {t('treeSuggest.preparing', { done: fmt.number(preparing.files), total: fmt.number(preparing.total ?? folder?.files.length ?? 0) })}
              </p>
            )}
            {source === 'computer' && tickedAlbums.length > 0 && !reading && (
              <div className="ticked-bar" role="region" aria-label={t('treeSuggest.ticked', { count: tickedAlbums.length })}>
                <p>
                  <strong>{t('treeSuggest.ticked', { count: tickedAlbums.length })}</strong>
                  <span className="hint">
                    {' · '}
                    {t('importEstimate.files', { count: tickedSizes.files, files: fmt.number(tickedSizes.files), size: fmt.bytes(tickedSizes.bytes) })}
                    {' · '}
                    {t('treeSuggest.tickedDrive', { size: fmt.bytes(tickedEstimate.driveBytes) })}
                    {' · ≈ '}
                    {duration(tickedEstimate.ms)}
                  </span>
                </p>
                {tickedEstimate.ms > LONG_MS && <p className="hint">{t('treeSuggest.longImport')}</p>}
                <div className="row">
                  <label className="row">
                    {t('treeSuggest.putInto')}
                    <select value={OWN} disabled={busy} onChange={(e) => putTicked(e.target.value)}>
                      <option value={OWN}>{t('treeSuggest.ownCategory')}</option>
                      {CATEGORY_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {proposal.labelOf(k)}
                        </option>
                      ))}
                      <option value="">{t('autoCategories.none')}</option>
                    </select>
                  </label>
                  <button className="btn" disabled={busy} onClick={() => setTicked(new Set())}>
                    {t('treeSuggest.untick')}
                  </button>
                  <button className="btn primary" disabled={busy} onClick={() => void importAlbums(tickedAlbums, null)}>
                    <Upload size={16} /> {t('treeSuggest.importTicked', { count: tickedAlbums.length })}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {progress && (
          <div className="import-progress" aria-live="polite">
            <strong>
              {busy && <Loader2 size={14} className="spin" />} {t('autoCategories.moving', { done: progress.done + progress.failed, total: progress.total })}
            </strong>
            <progress max={progress.total || 1} value={progress.done + progress.failed} />
          </div>
        )}
        {result && (
          <>
            <p className="ok-text">{t('autoCategories.moved', { count: result.moved })}</p>
            {result.failed > 0 && <p className="error-text">{t('autoCategories.failed', { count: result.failed })}</p>}
          </>
        )}
      </div>
      <div className="actions">
        {!progress && (
          <>
            <button className="btn" disabled={busy} onClick={onClose}>
              {t('common.close')}
            </button>
            {source === 'computer' && folder && kept.length > 0 && (
              <button className="btn" disabled={busy} onClick={() => void createOnly()}>
                {creating && <Loader2 size={16} className="spin" />} {t('treeSuggest.createOnly', { count: kept.length })}
              </button>
            )}
            {source === 'computer' && folder && !big && leftAlbums.length > 0 && (
              <button className="btn primary" disabled={busy || !folder.files.length} onClick={() => void importFolder()}>
                {t('treeSuggest.import', { count: left.files })}
              </button>
            )}
            {source === 'library' && (
              <button className="btn primary" disabled={!moves.length} onClick={() => void sortLibrary()}>
                {t('autoCategories.organizeButton', { count: moves.length })}
              </button>
            )}
          </>
        )}
        {result && (
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
    </Modal>
  )
}
