import { ArrowRight, Check, Cloud, FileArchive, FileText, FolderOpen, ImagePlus, Loader2, Play, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { extractFiles, FacebookFormatError, isFacebookZip, readFacebookZip, type FacebookExport } from '../import/facebook'
import { zipMedia } from '../import/zip'
import { findReplacements } from '../import/replace'
import { loadThumb } from '../sync/thumbs'
import { addPicked, analyze, cancelImport, insideDestination, pickedFolder, mediaFiles, runImport, withFacebookPosts, type ImportItem, type ImportOutcome } from '../import/importer'
import { speciesInText } from '../lib/katia'
import { importSourceName } from '../lib/provenance'
import { useFormat } from '../i18n/format'
import { placementOf } from '../lib/tree'
import { albumDirs } from '../lib/folderNames'
import { DOC_EXT_MIME } from '../lib/media'
import { auth } from '../auth/google'
import { recordImport } from '../import/importTrack'
import { useApp } from '../store'
import { Modal } from './Dialog'
import { CategoryProposal, useCategoryProposal, type CategoryChoice, type ProposalAlbum } from './CategoryProposal'
import { mostYear, yearFirst } from '../lib/albumYear'
import { albumNameOf } from '../lib/cameraFolders'
import { diskDirOf } from '../import/folderWalk'
import { DriveImportDialog } from './DriveImportDialog'
import { FolderTreePicker } from './FolderTreePicker'
import type { Library } from './useLibrary'

interface Props {
  lib: Library
  /** Initial destination folder (album, category or root). */
  destId: string
  /** Files already chosen (received from the Share menu). */
  initialFiles?: File[]
  /** Opened from the Share menu of another app: its destination is kept for the next share. */
  fromShare?: boolean
  /** From "Tree suggestion": the folder goes into MyMedia with the categories checked there. */
  categories?: CategoryChoice
  /** After each sending: files now in MyMedia (sent, or there already), files that failed. */
  onFinished?: (r: { inMyMedia: number; failed: number }) => void
  /**
   * From "Tree suggestion": several albums (each file's first folder is its album), sent one after the
   * other, each into its own destination (its category, or MyMedia itself).
   */
  albums?: AlbumTarget[]
  /** After each album of `albums` (and after a retry of its failed files). */
  onAlbumFinished?: (album: string, r: { inMyMedia: number; failed: number }) => void
  /** With `albums`: the name of the folder read on the disk (each album's origin is its folder below it). */
  diskRoot?: string
  /** With `albums`: the year first in the albums' names (from the name, or from the photos). */
  yearFirst?: boolean
  onClose: () => void
}

export interface AlbumTarget {
  name: string
  /** Its category's folder, or the root. */
  destId: string
  category: string | null
}

const RECENT_KEY = 'mymedia.recentDestinations'
const DISK_ROOTS_KEY = 'mymedia.diskRoots'

/** Where a folder read for "Tree suggestion" is on the computer ("E:\\myBackup"), as typed last time. */
function diskRootPath(name: string): string {
  try {
    return (JSON.parse(localStorage.getItem(DISK_ROOTS_KEY) ?? '{}') as Record<string, string>)[name] ?? name
  } catch {
    return name
  }
}

function rememberDiskRoot(name: string, path: string) {
  try {
    const all = JSON.parse(localStorage.getItem(DISK_ROOTS_KEY) ?? '{}') as Record<string, string>
    localStorage.setItem(DISK_ROOTS_KEY, JSON.stringify({ ...all, [name]: path }))
  } catch {
    // a convenience only
  }
}

/** "E:\\myBackup" + ["My Pictures", "Tyoul2015"]: with the separator the path typed uses. */
function joinPath(root: string, dir: string[]): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return [root.replace(/[\\/]+$/, ''), ...dir].join(sep)
}

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

const SHARE_DEST_KEY = 'mymedia.shareDestination'

/** Where the last files shared from another app went (offered again the next time). */
export function lastShareDestination(): string | null {
  try {
    return localStorage.getItem(SHARE_DEST_KEY)
  } catch {
    return null
  }
}

function rememberShareDestination(id: string) {
  try {
    localStorage.setItem(SHARE_DEST_KEY, id)
  } catch {
    // a convenience only
  }
}

const PATH_KEY = 'mymedia.lastImportPath'

/** The full path of a picked folder: where the last one was, with this folder's name. */
function suggestedPath(folder: string): string {
  try {
    const last = localStorage.getItem(PATH_KEY)
    if (last) return last.replace(/[^/\\]+[/\\]*$/, '') + folder
  } catch {
    // a convenience only
  }
  return folder
}

function rememberPath(path: string) {
  try {
    localStorage.setItem(PATH_KEY, path)
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
      {url ? <img src={url} alt="" loading="lazy" /> : item.type === 'video' ? <Play size={18} className="flip-rtl" style={{ margin: 11 }} /> : item.type === 'document' ? <FileText size={18} style={{ margin: 11 }} /> : null}
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
export function ImportDialog({ lib, destId: initialDest, initialFiles, fromShare, categories, onFinished, albums, onAlbumFinished, diskRoot, yearFirst: yearFirstAsked, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  // A destination since removed: the root instead.
  // A category just made for a followed import may not be loaded yet: kept.
  const [destId, setDestId] = useState(() => (initialDest === rootId || lib.folders.has(initialDest) || onFinished || albums ? initialDest : rootId))
  // The album being sent (several albums from "Tree suggestion").
  const [current, setCurrent] = useState<{ index: number; name: string } | null>(null)
  const stopped = useRef(false)
  const [yearOn, setYearOn] = useState(!!yearFirstAsked)
  const [phase, setPhase] = useState<'pick' | 'zip' | 'groups' | 'analyze' | 'match' | 'choose' | 'upload' | 'done'>('pick')
  const [fb, setFb] = useState<FacebookExport | null>(null)
  const [fbGroups, setFbGroups] = useState<Set<string>>(new Set())
  const [zipName, setZipName] = useState<string | undefined>()
  const [zipError, setZipError] = useState<string | null>(null)
  const [analyzed, setAnalyzed] = useState({ done: 0, total: 0 })
  const [picked, setItems] = useState<ImportItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [compress, setCompress] = useState(true)
  const [originPath, setOriginPath] = useState('')
  // Where a chosen folder goes: as a new album, its photos straight into the destination, or sorted by MyMedia.
  const [where, setWhere] = useState<'album' | 'direct' | 'sort' | 'categories' | null>(categories ? 'categories' : null)
  const [outcomes, setOutcomes] = useState<Record<string, ImportOutcome>>({})
  const [result, setResult] = useState<{ count: number; before: number; after: number } | null>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const folderInput2 = useRef<HTMLInputElement>(null)
  const [fromDrive, setFromDrive] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const zipInput = useRef<HTMLInputElement>(null)
  const canPickFolder = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent)

  const nameOf = (id: string) => {
    if (id === rootId) return useApp.getState().settings.rootName
    const p = placementOf(id, lib.folders, rootId)
    return [p.category, p.album].filter(Boolean).join(' / ')
  }
  const destName = nameOf(destId)
  const topFolder = fb ? null : pickedFolder(picked)
  // Into the root or a category that has albums, MyMedia can sort the photos itself.
  const canSort = destId === rootId || (lib.folders.get(destId)?.parentId === rootId && [...lib.folders.values()].some((f) => f.parentId === destId))
  const fallback = topFolder !== null ? 'album' : 'direct'
  // A choice no longer offered (another folder added, another destination): the default.
  // Into MyMedia itself, the chosen folder's sub-folders can be put into categories proposed from their names.
  const flat = useMemo(() => {
    if (fb || destId !== rootId) return []
    // The albums wherever they are below the chosen folder (inside "My Pictures2004"…).
    const dirs = albumDirs(picked.map((i) => i.relDir))
    return picked.map((i, k) => ({ ...i, relDir: dirs[k] }))
  }, [fb, destId, rootId, picked])
  const proposalAlbums = useMemo<ProposalAlbum[]>(() => {
    const counts = new Map<string, number>()
    for (const i of flat) if (i.relDir.length) counts.set(i.relDir[0], (counts.get(i.relDir[0]) ?? 0) + 1)
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
  }, [flat])
  const canCategorize = proposalAlbums.length >= 2
  const proposal = useCategoryProposal(proposalAlbums, categories)
  const place =
    (where === 'album' && topFolder === null) || (where === 'sort' && !canSort) || (where === 'categories' && !canCategorize) ? fallback : (where ?? fallback)
  const { categoryOf } = proposal
  const items = useMemo(() => {
    if (place !== 'categories') return insideDestination(picked, place === 'album')
    return flat.map((i) => {
      const category = i.relDir.length ? categoryOf(i.relDir[0]) : null
      return category ? { ...i, relDir: [category, ...i.relDir] } : i
    })
  }, [picked, place, flat, categoryOf])
  const recent = recentDestinations().filter((id) => id !== destId && (id === rootId || lib.folders.has(id)))

  useEffect(() => {
    if (initialFiles?.length) void onFiles(initialFiles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onFiles(list: FileList | File[] | null, posts?: FacebookExport['posts'], add = false) {
    const files = mediaFiles([...(list ?? [])])
    if (!files.length) return
    setPhase('analyze')
    setAnalyzed({ done: 0, total: files.length })
    let result = await analyze(files, (done) => setAnalyzed({ done, total: files.length }))
    // Another folder: added to the ones chosen before (ticks kept).
    if (add) result = addPicked(picked, result)
    if (posts) {
      result = await withFacebookPosts(result, posts)
      setPhase('match')
      setAnalyzed({ done: 0, total: 0 })
      result = await findReplacements(result, (done, total) => setAnalyzed({ done, total }))
    }
    setItems(result)
    if (albums && diskRoot) setOriginPath(diskRootPath(diskRoot))
    else if (!posts) setOriginPath(suggestedPath(importSourceName({ relDirs: result.map((i) => i.relDir) })))
    const before = new Set(picked.map((i) => i.key))
    setChecked((cur) => new Set([...(add ? [...cur] : []), ...result.filter((i) => !i.duplicate && !(add && before.has(i.key))).map((i) => i.key)]))
    setPhase('choose')
  }

  /** A Facebook export (its groups are chosen next), or any ZIPs of photos (imported like a chosen folder). */
  async function onZip(list: File[]) {
    if (!list.length) return
    setZipError(null)
    setPhase('zip')
    try {
      const { default: JSZip } = await import('jszip')
      const files: File[] = []
      for (const file of list) {
        const zip = await JSZip.loadAsync(file)
        if (list.length === 1 && isFacebookZip(zip)) {
          const read = await readFacebookZip(file, zip)
          const groups = [...read.groups.entries()].sort((a, b) => b[1] - a[1])
          setFb(read)
          setZipName(file.name)
          setFbGroups(new Set(groups.slice(0, 1).map(([g]) => g)))
          setPhase('groups')
          return
        }
        files.push(...(await zipMedia(zip, file.name, () => undefined)))
      }
      if (!files.length) {
        setZipError(t('import.zipNoMedia'))
        setPhase('pick')
        return
      }
      await onFiles(files)
    } catch (e) {
      console.error('[MyMedia] ZIP not read', e)
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
  const hasFolders = !fb && picked.some((i) => i.relDir.length > 0)
  const sortByModel = hasFolders && canSort && place === 'sort'
  // The chosen folder's own photos (not those of its sub-folders), straight into the destination.
  const direct = selected.filter((i) => sortByModel || !i.relDir.length).length
  // Albums the chosen folder gives, as a tree: name, depth, photos, already in MyMedia or new.
  const albumTree = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      if (!i.relDir.length || !checked.has(i.key)) continue
      for (let d = 1; d <= i.relDir.length; d++) {
        const k = i.relDir.slice(0, d).join('/')
        counts.set(k, (counts.get(k) ?? 0) + (d === i.relDir.length ? 1 : 0))
      }
    }
    const childOf = (parentId: string | null, name: string) =>
      parentId === null
        ? null
        : ([...lib.folders.values()].find((f) => f.parentId === parentId && f.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)?.id ?? null)
    return [...counts.keys()].sort().map((k) => {
      const parts = k.split('/')
      let id: string | null = destId
      for (const p of parts) id = childOf(id, p)
      return { key: k, name: parts[parts.length - 1], depth: parts.length - 1, photos: counts.get(k) ?? 0, exists: id !== null }
    })
  }, [items, checked, lib.folders, destId])
  const topExists = topFolder !== null && [...lib.folders.values()].some((f) => f.parentId === destId && f.name.localeCompare(topFolder, undefined, { sensitivity: 'base' }) === 0)
  const hasSubFolders = topFolder !== null && picked.some((i) => i.relDir.length > 1)
  const duplicates = items.filter((i) => i.duplicate).length
  const replacements = items.filter((i) => i.replaces).length

  /** Each album: its folder as analysed, its name in MyMedia (year first if asked), its folders on the disk. */
  const albumPlan = useMemo(() => {
    if (!albums) return []
    return albums.map((a) => {
      const top = albumNameOf(a.name) ?? a.name
      const own = items.filter((i) => i.relDir[0] === top)
      // A file's own date says nothing of the event.
      const year = mostYear(own.filter((i) => i.dateSource !== 'file').map((i) => i.takenAt))
      const dirs = [...new Map(own.map((i) => diskDirOf(i.file)).filter((d): d is string[] => !!d).map((d) => [d.join('/'), d])).values()]
      return { ...a, top, finalName: yearOn ? yearFirst(top, year) : top, dirs }
    })
  }, [albums, items, yearOn])
  const diskBase = originPath.trim() || diskRoot || ''

  async function start() {
    if (albums) {
      if (diskRoot && originPath.trim()) rememberDiskRoot(diskRoot, originPath.trim())
      auth.renewBefore(Math.max(10, selected.length / 10) * 60_000)
      return send(selected)
    }
    rememberDestination(destId)
    if (fromShare) rememberShareDestination(destId)
    const from = importSourceName({ zipName: fb ? zipName : undefined, relDirs: picked.map((i) => i.relDir) })
    const path = !fb && from && originPath.trim() !== from ? originPath.trim() : undefined
    if (path) rememberPath(path)
    auth.renewBefore(Math.max(10, selected.length / 10) * 60_000)
    sendOpts.current = { from, path }
    await send(selected)
  }

  /** After the upload: the album (or category) the files went to is shown. */
  function showDestination() {
    const { categoryId, albumId } = destId === rootId ? { categoryId: null, albumId: null } : placementOf(destId, lib.folders, rootId)
    useApp.getState().setFilters({ categoryId, albumId, personId: null, provenance: null })
    onClose()
  }

  const sendOpts = useRef<{ from: string; path?: string }>({ from: '' })
  const sentTotal = useRef(0)
  async function send(list: ImportItem[]) {
    setPhase('upload')
    const toSend = fb
      ? list.map((i) => {
          const species = speciesOf(i)
          return species ? { ...i, relDir: [species], extra: { ...i.extra, species } } : i
        })
      : list
    const onItem = (key: string, o: ImportOutcome) => setOutcomes((prev) => ({ ...prev, [key]: o }))
    stopped.current = false
    if (albums) {
      const r = await sendAlbums(toSend, albums, onItem)
      setResult((prev) => (prev ? { count: prev.count + r.count, before: prev.before + r.before, after: prev.after + r.after } : r))
      setCurrent(null)
      setPhase('done')
      return
    }
    const started = performance.now()
    const r = await runImport(toSend, destId, {
      compress,
      keepFolders: !sortByModel,
      ...sendOpts.current,
    }, onItem)
    recordImport(r.before, r.after, performance.now() - started)
    sentTotal.current += r.count
    onFinished?.({ inMyMedia: sentTotal.current + duplicates, failed: selected.length - sentTotal.current })
    // A retry adds to what was sent before.
    setResult((prev) => (prev ? { count: prev.count + r.count, before: prev.before + r.before, after: prev.after + r.after } : r))
    setPhase('done')
  }

  /** Album after album, each into its destination; each one marked as soon as it is done. */
  const sentByAlbum = useRef(new Map<string, number>())
  async function sendAlbums(list: ImportItem[], targets: AlbumTarget[], onItem: (key: string, o: ImportOutcome) => void) {
    const total = { count: 0, before: 0, after: 0 }
    for (const [index, target] of targets.entries()) {
      // Its folder as the analysis named it ("442___02Pourim5773" → "Pourim5773").
      const plan = albumPlan.find((a) => a.name === target.name)
      const top = plan?.top ?? albumNameOf(target.name) ?? target.name
      const finalName = plan?.finalName ?? top
      const ofAlbum = (i: ImportItem) => i.relDir[0] === top
      const group = list.filter(ofAlbum).map((i) => ({ ...i, relDir: [finalName, ...i.relDir.slice(1)] }))
      if (!group.length) continue
      if (stopped.current) break
      setCurrent({ index, name: finalName })
      // By folder of the disk: each file keeps where its original is (and its folder's own name).
      const byDir = new Map<string, { dir: string[] | null; items: ImportItem[] }>()
      for (const i of group) {
        const dir = diskDirOf(i.file) ?? null
        const k = dir?.join('/') ?? ''
        ;(byDir.get(k) ?? byDir.set(k, { dir, items: [] }).get(k)!).items.push(i)
      }
      let count = 0
      for (const { dir, items: part } of byDir.values()) {
        if (stopped.current) break
        const from = dir?.[dir.length - 1] ?? target.name
        const path = dir && diskBase ? joinPath(diskBase, dir) : undefined
        const started = performance.now()
        const r = await runImport(part, target.destId, { compress, keepFolders: true, from, path }, onItem)
        recordImport(r.before, r.after, performance.now() - started)
        count += r.count
        total.before += r.before
        total.after += r.after
      }
      total.count += count
      const sent = (sentByAlbum.current.get(target.name) ?? 0) + count
      sentByAlbum.current.set(target.name, sent)
      onAlbumFinished?.(target.name, {
        inMyMedia: sent + items.filter((i) => ofAlbum(i) && i.duplicate).length,
        failed: selected.filter(ofAlbum).length - sent,
      })
    }
    return total
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
            {fmt.bytes(i.replaces.size)} {fmt.arrow} {fmt.bytes(i.file.size)}
          </>
        )
      return compress && i.estimate !== null ? (
        <>
          {fmt.bytes(i.file.size)} {fmt.arrow} ≈ {fmt.bytes(i.estimate)}
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
      <span className="error-text" title={o.message}>
        <X size={14} /> {t('compress.failed')}
        <br />
        <span className="hint clamp-1">{o.message}</span>
      </span>
    )
  }

  const sent = selected.filter((i) => outcomes[i.key]?.status === 'done').length
  const failed = selected.filter((i) => outcomes[i.key]?.status === 'error')
  const failedCount = failed.length

  // Once sent, the files in error come first, so they are seen.
  const sortedItems = useMemo(() => {
    const bad = (i: ImportItem) => (phase === 'done' && outcomes[i.key]?.status === 'error' ? 0 : 1)
    return [...items].sort((a, b) => bad(a) - bad(b) || a.takenAt.localeCompare(b.takenAt))
  }, [items, phase, outcomes])

  if (fromDrive) return <DriveImportDialog lib={lib} destId={destId} onClose={onClose} />
  return (
    <Modal wide title={t('import.title')} onClose={phase === 'upload' ? () => undefined : onClose}>
      <div className="row" style={{ marginBlockEnd: 10 }}>
        <span>{t('import.to')}</span>
        <strong>
          <bdi>{albums ? t('import.albumsDest', { count: albums.length }) : destName}</bdi>
        </strong>
        {!albums && (phase === 'pick' || phase === 'groups' || phase === 'choose') && (
          <button className="btn ghost" aria-expanded={treeOpen} onClick={() => setTreeOpen((o) => !o)}>
            <FolderOpen size={16} /> {t('import.changeDest')}
          </button>
        )}
      </div>
      {treeOpen && (phase === 'pick' || phase === 'groups' || phase === 'choose') && (
        <div style={{ marginBlockEnd: 10 }}>
          <FolderTreePicker
            categories={lib.categories}
            value={destId}
            onChange={(id) => {
              setDestId(id)
              setTreeOpen(false)
            }}
            root={{ id: rootId, label: <bdi>{useApp.getState().settings.rootName}</bdi> }}
          />
        </div>
      )}

      {!albums && (phase === 'pick' || phase === 'groups' || phase === 'choose') && recent.length > 0 && (
        <div className="chip-list">
          {recent.map((id) => (
            <button key={id} className="chip-btn" onClick={() => { setDestId(id); setTreeOpen(false) }}>
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
            <button className="btn" onClick={() => setFromDrive(true)} title={t('driveImport.buttonHint')}>
              <Cloud size={18} /> {t('driveImport.button')}
            </button>
          </div>
          {zipError && <p className="error-text">{zipError}</p>}
          <p className="hint">{t('import.dateHint')}</p>
          <p className="hint">{t('facebook.hint')}</p>
          <input ref={zipInput} type="file" multiple hidden accept=".zip,application/zip" onChange={(e) => void onZip(e.target.files ? [...e.target.files] : [])} />
          <input ref={filesInput} type="file" multiple hidden accept={`image/*,video/*,.heic,.heif,.mov,.avi,${Object.keys(DOC_EXT_MIME).map((e) => `.${e}`).join(',')}`} onChange={(e) => onFiles(e.target.files)} />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => onFiles(e.target.files)}
          />
        </>
      )}
      {/* Another folder, after the first: the browser chooses one folder at a time. */}
      <input
        ref={folderInput2}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : []
          e.target.value = ''
          void onFiles(files, undefined, true)
        }}
      />

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

      {(phase === 'upload' || phase === 'done') && (
        <div className="import-progress" aria-live="polite">
          {albums && current && phase === 'upload' && (
            <div>
              {t('import.albumOf', { index: current.index + 1, total: albums.length })} <strong><bdi>{current.name}</bdi></strong>
            </div>
          )}
          <strong>{t('import.progress', { done: fmt.number(sent + failedCount), total: fmt.number(selected.length) })}</strong>
          {failedCount > 0 && <span className="error-text"> · {t('import.progressFailed', { count: failedCount })}</span>}
          <progress max={selected.length || 1} value={sent + failedCount} />
        </div>
      )}

      {(phase === 'choose' || phase === 'upload' || phase === 'done') && (
        <>
          {phase === 'choose' && !albums && canPickFolder && !fb && picked.some((i) => i.relDir.length > 0) && (
            <div className="row">
              <span className="hint">
                {t('import.chosenFolders', { names: [...new Set(picked.map((i) => i.relDir[0]).filter(Boolean))].join(', ') })}
              </span>
              <button className="btn" onClick={() => folderInput2.current?.click()}>
                <FolderOpen size={16} /> {t('import.addFolder')}
              </button>
            </div>
          )}
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
                      {i.relDir.length > 0 && !fb && !sortByModel && (
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
              {albums && (
                <>
                  <label className="radio-row">
                    <input type="checkbox" checked={yearOn} onChange={(e) => setYearOn(e.target.checked)} />
                    {t('import.yearFirst')}
                  </label>
                  <label className="field">
                    <span>{t('import.diskRoot')}</span>
                    <input type="text" dir="ltr" value={originPath} onChange={(e) => setOriginPath(e.target.value)} spellCheck={false} />
                    <span className="hint">{t('import.diskRootHint', { name: diskRoot ?? '' })}</span>
                  </label>
                  <ul className="import-albums">
                    {albumPlan.map((a) => (
                      <li key={a.name}>
                        <bdi>{a.category ? `${a.category} / ${a.finalName}` : a.finalName}</bdi>
                        {a.dirs.map((d) => (
                          <span key={d.join('/')} className="hint" dir="ltr">
                            {' ← '}
                            {joinPath(diskBase, d)}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!albums && hasFolders && (topFolder !== null || canSort || canCategorize) && (
                <div className="folder-mode" role="radiogroup" aria-label={t('import.whereTitle', { count: selected.length })}>
                  <p>
                    <strong>{t('import.whereTitle', { count: selected.length })}</strong>
                  </p>
                  {topFolder !== null && (
                    <label className="radio-row">
                      <input type="radio" name="folder-mode" checked={place === 'album'} onChange={() => setWhere('album')} />
                      <span>{t(topExists ? 'import.whereAlbumExisting' : 'import.whereAlbumNew', { name: topFolder, dest: destName })}</span>
                    </label>
                  )}
                  <label className="radio-row">
                    <input type="radio" name="folder-mode" checked={place === 'direct'} onChange={() => setWhere('direct')} />
                    <span>
                      {topFolder === null
                        ? t('import.whereFolders', { dest: destName })
                        : t(hasSubFolders ? 'import.whereDirectSub' : 'import.whereDirect', { dest: destName })}
                    </span>
                  </label>
                  {canCategorize && (
                    <label className="radio-row">
                      <input type="radio" name="folder-mode" checked={place === 'categories'} onChange={() => setWhere('categories')} />
                      <span>{t('autoCategories.importChoice', { count: proposalAlbums.length })}</span>
                    </label>
                  )}
                  {place === 'categories' && <CategoryProposal state={proposal} />}
                  {canSort && (
                    <label className="radio-row">
                      <input type="radio" name="folder-mode" checked={place === 'sort'} onChange={() => setWhere('sort')} />
                      <span>
                        {t('import.whereSort', { dest: destName })}
                        {place === 'sort' && (
                          <>
                            <br />
                            <span className="hint">{t('import.whereSortHint')}</span>
                          </>
                        )}
                      </span>
                    </label>
                  )}
                </div>
              )}
              {hasFolders && (
                <div className="album-tree">
                  <p>{t('import.result')}</p>
                  <ul>
                    <li>
                      <FolderOpen size={15} /> <strong><bdi>{destName}</bdi></strong>
                      {direct > 0 && (
                        <span className="hint">
                          {' — '}
                          {t('import.albumPhotos', { count: direct })}
                          {sortByModel && <> · {t('import.resultSorted')}</>}
                        </span>
                      )}
                    </li>
                    {!sortByModel &&
                      albumTree.map((a) => (
                        <li key={a.key} style={{ paddingInlineStart: (a.depth + 1) * 22 }}>
                          <FolderOpen size={15} /> <strong><bdi>{a.name}</bdi></strong>
                          <span className="hint">
                            {' — '}
                            {a.photos ? t('import.albumPhotos', { count: a.photos }) : t('import.albumOnlySub')}
                            {' · '}
                            {a.exists ? t('import.albumExists') : t('import.albumNew')}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              {!albums && !fb && importSourceName({ relDirs: picked.map((i) => i.relDir) }) && (
                <label className="field">
                  <span>{t('import.originPath')}</span>
                  <input type="text" dir="ltr" value={originPath} onChange={(e) => setOriginPath(e.target.value)} spellCheck={false} />
                  <span className="hint">{t('import.originPathHint')}</span>
                </label>
              )}
              {duplicates > 0 && duplicates === items.length ? (
                <p className="ok-text">
                  <Check size={16} /> <strong>{t('import.allImported', { count: duplicates })}</strong>
                </p>
              ) : (
                duplicates > 0 && <p className="hint">{t('import.duplicatesHint', { count: duplicates })}</p>
              )}
              {replacements > 0 && <p className="hint">{t('facebook.replaceHint', { count: replacements })}</p>}
              <p>
                <strong>
                  {t('compress.selection', { count: selected.length })}: {fmt.bytes(sizeBefore)}
                  {compress && sizeAfter < sizeBefore ? <> {fmt.arrow} ≈ {fmt.bytes(sizeAfter)}</> : null}
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
          {phase === 'done' && failedCount > 0 && (
            <p className="error-text">{t('import.failedHint', { count: failedCount })}</p>
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
          <button
            className="btn"
            onClick={() => {
              // The albums not started yet stay to do.
              stopped.current = true
              cancelImport()
            }}
          >
            {t('common.cancel')}
          </button>
        )}
        {phase === 'done' && failed.length > 0 && (
          <button className="btn" onClick={() => void send(failed)}>
            <RefreshCw size={16} /> {t('import.retryFailed', { count: failed.length })}
          </button>
        )}
        {(phase === 'done' || phase === 'pick') && (
          <button className={`btn ${phase === 'done' ? 'primary' : ''}`} onClick={phase === 'done' && result?.count && !albums ? showDestination : onClose}>
            {phase === 'done' ? t('common.ok') : t('common.cancel')}
          </button>
        )}
      </div>
    </Modal>
  )
}
