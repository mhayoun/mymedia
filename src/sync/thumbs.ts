// Thumbnails: Drive's thumbnail (any format, incl. HEIC and video), cached in
// IndexedDB for offline browsing. Loaded lazily, what is on screen first, in reading order.

import { db, type MediaRecord } from '../db/db'
import { childrenQuery, downloadBlob, driveStats, getFile, listFiles } from '../drive/api'
import { sizedThumbnailLink } from '../lib/media'
import { loadPack, packLoaded, packOf } from './thumbPacks'
import { videoFrameThumbnail } from './videoFrame'

/** Phones show smaller cells: smaller thumbnails (a third lighter), as sharp on their screen. */
const THUMB_SIZE = typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches ? 320 : 400
const MAX_PARALLEL = 20
/** A pack is downloaded for the screen when this many of its thumbnails are wanted (or this share of it): fewer, one by one is quicker. */
const PACK_MIN_WANTED = { fast: [12, 0.3], mobile: [25, 0.4] } as const
const MAX_URLS = 800
const LOCAL_RESIZE_MAX_BYTES = 25 * 1024 * 1024

interface Task {
  rec: MediaRecord
  /** Its pack was tried: loaded on its own. */
  noPack?: boolean
  /** Shown from Google's address failed: made another way. */
  noDirect?: boolean
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
    if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl)
  }
  return url
}

/** A thumbnail shown straight from Google's address (not kept on the device). */
function rememberUrl(id: string, url: string): string {
  urls.set(id, url)
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

/** Preview links tried: waiting, received, refused (by HTTP status), too slow, failed (diagnosis). */
const links = { pending: 0, ok: 0, timeout: 0, error: 0, notImage: 0, status: {} as Record<number, number>, lastError: '', direct: 0 }

/**
 * This browser cannot read Google's previews (seen on a phone: every request
 * fails at once), although it can show them. They are then shown straight
 * from their address, instead of downloading each original to make one.
 */
let showDirect = false

/** True when this browser cannot read Google's previews (since October 2026, no browser can). */
export function previewsUnreadable(): boolean {
  return showDirect
}

/** A phone: its data costs; it does not download the originals to analyse them or make packs. */
export const isPhone = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)

async function fetchThumbLink(link: string, size = THUMB_SIZE): Promise<Blob | null> {
  links.pending++
  try {
    const res = await fetch(sizedThumbnailLink(link, size), { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      links.status[res.status] = (links.status[res.status] ?? 0) + 1
      return null
    }
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) links.notImage++
    else links.ok++
    return blob.type.startsWith('image/') ? blob : null
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') links.timeout++
    else {
      links.error++
      links.lastError = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 80)
      if (links.ok === 0 && links.error >= 3 && navigator.onLine) showDirect = true
    }
    return null
  } finally {
    links.pending--
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
  // This browser cannot read them: no request to Google or Drive for nothing.
  if (showDirect) return null
  // The saved link first: it often still works, and needs no request to Drive (which may be
  // slowing down this account, e.g. while a computer makes the packs). Renewed when it failed.
  if (rec.thumbnailLink) {
    const b = await fetchThumbLink(rec.thumbnailLink, size)
    if (b) return b
  }
  if (!freshLinks.has(rec.folderId)) {
    await renewFolderLinks(rec.folderId)
    const link = (await db().media.get(rec.id))?.thumbnailLink
    if (link && link !== rec.thumbnailLink) {
      rec.thumbnailLink = link
      const b = await fetchThumbLink(link, size)
      if (b) return b
    }
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

/** The preview's address to show as it is (`renew`: the one shown did not load). */
async function directUrl(rec: MediaRecord, renew = false): Promise<string | null> {
  if (renew || !freshLinks.has(rec.folderId)) {
    await renewFolderLinks(rec.folderId, renew)
    rec.thumbnailLink = (await db().media.get(rec.id))?.thumbnailLink ?? rec.thumbnailLink
  }
  if (!rec.thumbnailLink) return null
  links.direct++
  return sizedThumbnailLink(rec.thumbnailLink, THUMB_SIZE)
}

const stats = { ok: 0, failed: 0, slowPacks: 0 }
/** When each thumbnail being made started (to see one that never ends). */
const running = new Set<number>()

async function produce(rec: MediaRecord): Promise<Blob | null> {
  const started = performance.now()
  running.add(started)
  try {
    const b = (await driveThumbnail(rec)) ?? (rec.type === 'video' ? await videoFrameThumbnail(rec, THUMB_SIZE) : await localPhotoPreview(rec))
    stats[b ? 'ok' : 'failed']++
    return b
  } finally {
    running.delete(started)
  }
}

/** What the thumbnails are doing now (diagnosis in the settings). */
export function thumbState() {
  const oldest = running.size ? Math.round((performance.now() - Math.min(...running)) / 1000) : 0
  return { links, drive: driveStats, size: THUMB_SIZE, active, queued: queue.length, waitingPacks: waitingPack.size, making: running.size, oldestSeconds: oldest, fast: isFastConnection(), type: connection()?.type ?? '?', ...stats }
}

type ConnectionInfo = { saveData?: boolean; type?: string; effectiveType?: string }
const connection = () => (navigator as Navigator & { connection?: ConnectionInfo }).connection

/** Wi-Fi or cable (a computer without the information counts as such; a phone does not). */
export function isFastConnection(): boolean {
  const c = connection()
  return c?.type === 'wifi' || c?.type === 'ethernet' || (!c?.type && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent))
}

/** Waiting for the pack being downloaded, by pack. */
const waitingPack = new Map<string, Task[]>()
/** A pack slower than this: its thumbnails are loaded one by one (the pack still arrives for later). */
const PACK_WAIT_MS = 5000

/** Its pack is worth downloading: when much of it is on screen (more on mobile data). */
function packToWaitFor(task: Task): string | null {
  if (task.noPack) return null
  const pack = packOf(task.rec.id)
  if (!pack || (packLoaded(pack.key) && !waitingPack.has(pack.key))) return null
  if (waitingPack.has(pack.key)) return pack.key
  let wanted = 1
  for (const t of queue) if (!t.cancelled && packOf(t.rec.id)?.key === pack.key) wanted++
  const [min, share] = PACK_MIN_WANTED[isFastConnection() ? 'fast' : 'mobile']
  return wanted >= Math.min(min, Math.ceil(pack.count * share)) ? pack.key : null
}

function waitForPack(task: Task, key: string) {
  const list = waitingPack.get(key)
  if (list) return void list.push(task)
  waitingPack.set(key, [task])
  active++
  let settled = false
  const release = (thumbs: Map<string, { version: string; blob: Blob }>) => {
    if (settled) return
    settled = true
    active--
    const tasks = waitingPack.get(key) ?? []
    waitingPack.delete(key)
    for (const t of tasks) {
      const s = thumbs.get(t.rec.id)
      if (s && (s.version === thumbVersion(t.rec) || s.version === t.rec.modifiedTime)) t.resolve(remember(t.rec.id, s.blob))
      else {
        // Not in the pack (newer than it): on its own.
        t.noPack = true
        queue.push(t)
      }
    }
    pump()
  }
  void loadPack(key).then(release)
  setTimeout(() => {
    if (!settled) {
      stats.slowPacks++
      console.warn('[MyMedia] thumbnail pack slow, loading one by one', key)
    }
    release(new Map())
  }, PACK_WAIT_MS)
}

let pumpTimer: ReturnType<typeof setTimeout> | null = null
/** Started a moment later: the cells of a screen ask together, so their pack is seen as wanted. */
function schedulePump() {
  pumpTimer ??= setTimeout(() => {
    pumpTimer = null
    pump()
  }, 30)
}

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const task = nextTask()!
    if (task.cancelled) {
      task.resolve(null)
      continue
    }
    const pack = packToWaitFor(task)
    if (pack) {
      waitForPack(task, pack)
      continue
    }
    if (showDirect && !task.noDirect) {
      active++
      directUrl(task.rec)
        .catch(() => null)
        .then((url) => {
          if (url) return task.resolve(rememberUrl(task.rec.id, url))
          task.noDirect = true
          queue.push(task)
        })
        .finally(() => {
          active--
          pump()
        })
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
/** The thumbnail shown could not be drawn: forgotten, and loaded again on its own (not from a pack). */
export async function reloadThumb(rec: MediaRecord, isWanted: () => boolean, order: () => number = () => 0): Promise<string | null> {
  const url = urls.get(rec.id)
  if (url) {
    urls.delete(rec.id)
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  await db().thumbs.delete(rec.id).catch(() => undefined)
  if (!navigator.onLine || !isWanted()) return null
  // Shown from Google's address: its link had expired, a new one.
  if (url && !url.startsWith('blob:')) {
    const fresh = await directUrl(rec, true).catch(() => null)
    if (fresh && fresh !== url) return rememberUrl(rec.id, fresh)
  }
  return new Promise<string | null>((resolve) => {
    queue.push({ rec, resolve, cancelled: false, order, noPack: true })
    schedulePump()
  })
}

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
      schedulePump()
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
  return queue.length > 0 || waitingPack.size > 0
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
  const c = connection()
  if (c?.saveData || /2g|3g/.test(c?.effectiveType ?? '')) return
  const fast = isFastConnection()
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
        // The other workers may have taken the last ones meanwhile.
        if (next >= todo.length) return
        const rec = todo[next++]
        if (urls.has(rec.id) || inflight.has(rec.id)) continue
        active++
        try {
          // On Wi-Fi, its whole pack at once (the next ones of the list are then already here).
          const pack = fast ? packOf(rec.id) : undefined
          if (pack) {
            const s = (await loadPack(pack.key)).get(rec.id)
            if (s && (s.version === thumbVersion(rec) || s.version === rec.modifiedTime)) continue
          }
          // Google's previews cannot be read here: not the originals in advance (only packs).
          if (showDirect) continue
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
