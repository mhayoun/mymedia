// Thumbnails: Drive's thumbnail (any format, incl. HEIC and video), cached in
// IndexedDB for offline browsing. Loaded lazily, what is on screen first, in reading order.

import { db, type MediaRecord } from '../db/db'
import { childrenQuery, downloadBlob, getFile, listFiles } from '../drive/api'
import { sizedThumbnailLink } from '../lib/media'
import { videoFrameThumbnail } from './videoFrame'

const THUMB_SIZE = 400
const MAX_PARALLEL = 12
const MAX_URLS = 800
const LOCAL_RESIZE_MAX_BYTES = 25 * 1024 * 1024

interface Task {
  rec: MediaRecord
  resolve: (url: string | null) => void
  cancelled: boolean
  /** Lower loads first (see `screenOrder`). */
  order: () => number
}

/**
 * Loading order of a thumbnail on the page: those on screen first, top row
 * first and, in a row, from the start of the line (right in Hebrew); then
 * those just below or above the screen, nearest first.
 */
export function screenOrder(el: Element | null): number {
  if (!el?.isConnected) return Number.MAX_SAFE_INTEGER
  const r = el.getBoundingClientRect()
  const h = window.innerHeight
  const w = window.innerWidth || 1
  const fromStart = document.documentElement.dir === 'rtl' ? w - r.right : r.left
  const inRow = Math.min(Math.max(fromStart / w, 0), 0.999)
  if (r.bottom > 0 && r.top < h) return Math.max(r.top, 0) + inRow
  const away = r.top >= h ? r.top - h : -r.bottom
  return 2 * h + away + inRow
}

/** The task to start now: the one nearest the top of the screen. */
function nextTask(): Task | undefined {
  let best = -1
  let bestOrder = Infinity
  for (let i = 0; i < queue.length; i++) {
    const o = queue[i].cancelled ? -1 : queue[i].order()
    if (o < bestOrder) {
      bestOrder = o
      best = i
    }
  }
  return best < 0 ? undefined : queue.splice(best, 1)[0]
}

const urls = new Map<string, string>() // id → object URL (insertion order = LRU)
const inflight = new Map<string, Promise<string | null>>()
const queue: Task[] = []
let active = 0

function remember(id: string, blob: Blob): string {
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  if (urls.size > MAX_URLS) {
    const [oldId, oldUrl] = urls.entries().next().value as [string, string]
    urls.delete(oldId)
    URL.revokeObjectURL(oldUrl)
  }
  return url
}

export function cachedThumbUrl(id: string): string | undefined {
  const url = urls.get(id)
  if (url) {
    urls.delete(id)
    urls.set(id, url)
  }
  return url
}

async function fetchThumbLink(link: string, size = THUMB_SIZE): Promise<Blob | null> {
  try {
    const res = await fetch(sizedThumbnailLink(link, size), { credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob.type.startsWith('image/') ? blob : null
  } catch {
    return null
  }
}

async function resizeLocally(blob: Blob, size: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  } catch {
    return null // e.g. HEIC in Chrome
  }
}

/** Thumbnail version: the content's MD5 (moves and renames keep it), else the modification date. */
export function thumbVersion(rec: MediaRecord): string {
  return rec.md5 ?? rec.modifiedTime
}

// Drive's preview links expire after a few hours. When one has expired, the
// others of the same folder have too: renew them all with one request.
const LINKS_TTL_MS = 3 * 3600 * 1000
/** A link failed although renewed this recently: not renewed again (the file simply has no preview). */
const RETRY_AFTER_MS = 60 * 1000
const freshLinks = new Map<string, { at: number; run: Promise<void> }>()

// When each folder's links were renewed, kept across visits: the app opened
// again within a few hours shows its thumbnails at once, without listing the
// folders first.
const RENEWED_KEY = 'mymedia-links-renewed'
function renewedAt(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(RENEWED_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function saveRenewed(ids: string[], at: number) {
  try {
    const all = renewedAt()
    for (const [id, t] of Object.entries(all)) if (at - t > LINKS_TTL_MS) delete all[id]
    for (const id of ids) all[id] = at
    localStorage.setItem(RENEWED_KEY, JSON.stringify(all))
  } catch {
    // private mode: renewed once per visit
  }
}
const stored = renewedAt()
for (const [id, at] of Object.entries(stored)) if (Date.now() - at < LINKS_TTL_MS) freshLinks.set(id, { at, run: Promise.resolve() })

/** These folders were just listed from Drive: their media's preview links are new, nothing to renew. */
export function markLinksFresh(folderIds: string[]): void {
  const now = Date.now()
  for (const id of folderIds) freshLinks.set(id, { at: now, run: Promise.resolve() })
  saveRenewed(folderIds, now)
}

function renewFolderLinks(folderId: string, force = false): Promise<void> {
  return renewLinks([folderId], force)
}

/**
 * Renews the preview links of several folders with one listing (40 folders a
 * request), so the albums on screen do not each wait for their own request.
 * `force`: a link failed, renew unless it was just done.
 */
function renewLinks(folderIds: string[], force = false): Promise<void> {
  const now = Date.now()
  const todo = [...new Set(folderIds)].filter((id) => {
    const cur = freshLinks.get(id)
    return !(cur && now - cur.at < (force ? RETRY_AFTER_MS : LINKS_TTL_MS))
  })
  const waits = folderIds.map((id) => freshLinks.get(id)?.run).filter((r): r is Promise<void> => !!r)
  if (todo.length) {
    const run = (async () => {
      const links: [string, string][] = []
      for (let i = 0; i < todo.length; i += 40) {
        await listFiles(childrenQuery(todo.slice(i, i + 40)), (files) => {
          for (const f of files) if (f.thumbnailLink) links.push([f.id, f.thumbnailLink])
        }, undefined, 'id,thumbnailLink')
      }
      await db().transaction('rw', db().media, async () => {
        for (const [id, thumbnailLink] of links) await db().media.update(id, { thumbnailLink })
      })
      saveRenewed(todo, now)
    })().catch(() => {
      for (const id of todo) freshLinks.delete(id)
    })
    for (const id of todo) freshLinks.set(id, { at: now, run })
    waits.push(run)
  }
  return Promise.all(waits).then(() => undefined)
}

/**
 * Called as soon as a list is shown: renews at once, in one request, the
 * preview links of the folders of its first media (those of the screen).
 * Registered right away, so the thumbnails of the screen wait for it instead
 * of each album asking Drive on its own.
 */
export function prepareLinks(recs: MediaRecord[]): void {
  if (!navigator.onLine) return
  const folders = recs.slice(0, 300).filter((r) => !urls.has(r.id)).map((r) => r.folderId)
  if (folders.length) renewLinks(folders).catch(() => undefined)
}

/** Drive's own preview image of a file (works for HEIC and videos too), or null. */
export async function driveThumbnail(rec: MediaRecord, size = THUMB_SIZE): Promise<Blob | null> {
  // Saved links older than a few hours have expired: renew the folder's before trying them.
  if (!freshLinks.has(rec.folderId)) {
    await renewFolderLinks(rec.folderId)
    rec.thumbnailLink = (await db().media.get(rec.id))?.thumbnailLink ?? rec.thumbnailLink
  }
  if (rec.thumbnailLink) {
    const b = await fetchThumbLink(rec.thumbnailLink, size)
    if (b) return b
  }
  const failed = rec.thumbnailLink
  await renewFolderLinks(rec.folderId, true)
  const link = (await db().media.get(rec.id))?.thumbnailLink
  if (link && link !== failed) {
    rec.thumbnailLink = link
    const b = await fetchThumbLink(link, size)
    if (b) return b
  }
  // Still nothing: ask Drive about this file alone.
  try {
    const f = await getFile(rec.id, 'id,thumbnailLink')
    if (f.thumbnailLink) {
      await db().media.update(rec.id, { thumbnailLink: f.thumbnailLink })
      rec.thumbnailLink = f.thumbnailLink
      return await fetchThumbLink(f.thumbnailLink, size)
    }
  } catch {
    // no preview available
  }
  return null
}

/** The original photo reduced to `size` pixels (not possible for HEIC in most browsers). */
export async function localPhotoPreview(rec: MediaRecord, size = THUMB_SIZE): Promise<Blob | null> {
  if (rec.type !== 'photo' || rec.size <= 0 || rec.size > LOCAL_RESIZE_MAX_BYTES) return null
  try {
    return await resizeLocally(await downloadBlob(rec.id), size)
  } catch {
    return null
  }
}

async function produce(rec: MediaRecord): Promise<Blob | null> {
  const b = await driveThumbnail(rec)
  if (b) return b
  if (rec.type === 'video') return videoFrameThumbnail(rec, THUMB_SIZE)
  return localPhotoPreview(rec)
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const task = nextTask()!
    if (task.cancelled) {
      task.resolve(null)
      continue
    }
    active++
    produce(task.rec)
      .then(async (blob) => {
        if (!blob) return task.resolve(null)
        // Shown at once; kept on the device after (writing is slow on phones).
        task.resolve(remember(task.rec.id, blob))
        await db().thumbs.put({ id: task.rec.id, version: thumbVersion(task.rec), blob })
      })
      .catch(() => task.resolve(null))
      .finally(() => {
        active--
        pump()
      })
  }
}

/**
 * Returns an object URL for the thumbnail, or null if none can be produced.
 * `isWanted` lets a scrolled-away cell drop its queued request; `order` (see
 * `screenOrder`) puts it in line, on-screen first (default: right away).
 */
export function loadThumb(rec: MediaRecord, isWanted: () => boolean, order: () => number = () => 0): Promise<string | null> {
  const hit = cachedThumbUrl(rec.id)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(rec.id)
  if (pending) return pending
  const p = (async () => {
    const stored = await db().thumbs.get(rec.id)
    const valid = stored && (stored.version === thumbVersion(rec) || stored.version === rec.modifiedTime)
    if (stored && (valid || !navigator.onLine)) return remember(rec.id, stored.blob)
    if (!navigator.onLine) return null
    if (!isWanted()) return null
    return new Promise<string | null>((resolve) => {
      const task: Task = { rec, resolve, cancelled: false, order }
      queue.push(task)
      const check = setInterval(() => {
        if (!isWanted()) task.cancelled = true
      }, 500)
      const done = (url: string | null) => {
        clearInterval(check)
        resolve(url)
      }
      task.resolve = done
      pump()
    })
  })().finally(() => inflight.delete(rec.id))
  inflight.set(rec.id, p)
  return p
}

// ---- Preparing in advance -----------------------------------------------------

const WARM_WORKERS = 4
/** Prepared in advance on Wi-Fi besides what is browsed: the first photos of every album, then the newest. */
const COVERS_PER_ALBUM = 9
const LIBRARY_WARM_MAX = 3000
let libraryWarm: MediaRecord[] = []

/** The whole library, for the thumbnails prepared in advance on Wi-Fi. */
export function setLibraryForWarm(all: MediaRecord[]): void {
  const newest = [...all].sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))
  const byFolder = new Map<string, number>()
  const covers: MediaRecord[] = []
  const rest: MediaRecord[] = []
  for (const r of newest) {
    const n = byFolder.get(r.folderId) ?? 0
    byFolder.set(r.folderId, n + 1)
    ;(n < COVERS_PER_ALBUM ? covers : rest).push(r)
  }
  libraryWarm = [...covers, ...rest].slice(0, LIBRARY_WARM_MAX)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let warmGen = 0

/** True while thumbnails asked for by the screen are still loading. */
export function screenLoading(): boolean {
  return queue.length > 0
}

/** Waits until the thumbnails on screen are loaded (other work gives way to them). */
let viewing = false
/** A photo is open in the viewer: background work (analysis, thumbnails in advance) waits, the photo gets the network and the processor. */
export function setViewing(on: boolean): void {
  viewing = on
}

export async function afterScreenThumbs(): Promise<void> {
  while (screenLoading() || viewing) await sleep(300)
}

/**
 * Downloads, in the background, the thumbnails of the media being browsed
 * (the open album or list), so they are already on the device when the user
 * scrolls to them. Gives way to the thumbnails on screen.
 */
export function warmThumbs(all: MediaRecord[]): void {
  const gen = ++warmGen
  // Data saver or slow network: nothing in advance; mobile data: the first 200 only.
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string; effectiveType?: string } }).connection
  if (c?.saveData || /2g|3g/.test(c?.effectiveType ?? '')) return
  const fast = c?.type === 'wifi' || c?.type === 'ethernet' || (!c?.type && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent))
  // On Wi-Fi, then the rest of the library: every album opens at once the first time too.
  const inList = new Set(all.map((r) => r.id))
  const recs = c?.type === 'cellular' ? all.slice(0, 200) : fast ? [...all, ...libraryWarm.filter((r) => !inList.has(r.id))] : all
  void (async () => {
    await sleep(1500) // the list may still change (live updates)
    if (gen !== warmGen || !navigator.onLine) return
    const stored = await db().thumbs.bulkGet(recs.map((r) => r.id))
    const todo = recs.filter((r, i) => {
      const s = stored[i]
      return !(s && (s.version === thumbVersion(r) || s.version === r.modifiedTime))
    })
    let next = 0
    const worker = async () => {
      while (next < todo.length) {
        if (gen !== warmGen || !navigator.onLine) return
        while (screenLoading() || viewing || active >= MAX_PARALLEL - 4) {
          await sleep(200)
          if (gen !== warmGen) return
        }
        const rec = todo[next++]
        if (urls.has(rec.id) || inflight.has(rec.id)) continue
        active++
        try {
          const blob = await produce(rec)
          if (blob) await db().thumbs.put({ id: rec.id, version: thumbVersion(rec), blob })
        } catch {
          // tried again when it scrolls into view
        } finally {
          active--
          pump()
        }
      }
    }
    await Promise.all(Array.from({ length: WARM_WORKERS }, worker))
  })()
}
