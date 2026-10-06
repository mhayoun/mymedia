// Thumbnails: Drive's thumbnail (any format, incl. HEIC and video), cached in
// IndexedDB for offline browsing. Loaded lazily, newest request first.

import { db, type MediaRecord } from '../db/db'
import { downloadBlob, getFile } from '../drive/api'
import { sizedThumbnailLink } from '../lib/media'
import { videoFrameThumbnail } from './videoFrame'

const THUMB_SIZE = 400
const MAX_PARALLEL = 6
const MAX_URLS = 800
const LOCAL_RESIZE_MAX_BYTES = 25 * 1024 * 1024

interface Task {
  rec: MediaRecord
  resolve: (url: string | null) => void
  cancelled: boolean
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

/** Drive's own preview image of a file (works for HEIC and videos too), or null. */
export async function driveThumbnail(rec: MediaRecord, size = THUMB_SIZE): Promise<Blob | null> {
  if (rec.thumbnailLink) {
    const b = await fetchThumbLink(rec.thumbnailLink, size)
    if (b) return b
  }
  // Links expire after a few hours: ask Drive for a fresh one.
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
    const task = queue.pop()! // newest first: what is on screen now
    if (task.cancelled) {
      task.resolve(null)
      continue
    }
    active++
    produce(task.rec)
      .then(async (blob) => {
        if (!blob) return task.resolve(null)
        await db().thumbs.put({ id: task.rec.id, version: task.rec.modifiedTime, blob })
        task.resolve(remember(task.rec.id, blob))
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
 * `isWanted` lets a scrolled-away cell drop its queued request.
 */
export function loadThumb(rec: MediaRecord, isWanted: () => boolean): Promise<string | null> {
  const hit = cachedThumbUrl(rec.id)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(rec.id)
  if (pending) return pending
  const p = (async () => {
    const stored = await db().thumbs.get(rec.id)
    if (stored && (stored.version === rec.modifiedTime || !navigator.onLine)) return remember(rec.id, stored.blob)
    if (!navigator.onLine) return null
    if (!isWanted()) return null
    return new Promise<string | null>((resolve) => {
      const task: Task = { rec, resolve, cancelled: false }
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
