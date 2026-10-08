// Large previews (photo viewer): Drive's preview at screen size, kept on the
// device so a photo opens at once the second time. The neighbours of the
// photo on screen are prepared in advance, so swiping is instant too.

import type { MediaRecord } from '../db/db'
import { driveThumbnail, thumbVersion } from './thumbs'

export const PREVIEW_CACHE = 'mymedia-previews'
export const VIDEO_CACHE = 'mymedia-videos'
const PREVIEW_SIZE = 2048
/** About 300 previews (≈ 100–150 MB); the oldest are removed first. */
const MAX_PREVIEWS = 300

const inflight = new Map<string, Promise<Blob | null>>()

const keyOf = (rec: MediaRecord) => new Request(`${location.origin}/__preview/${encodeURIComponent(rec.id)}?v=${encodeURIComponent(thumbVersion(rec))}`)

async function open(): Promise<Cache | null> {
  try {
    return 'caches' in self ? await caches.open(PREVIEW_CACHE) : null
  } catch {
    return null // private mode
  }
}

async function trim(cache: Cache) {
  const keys = await cache.keys()
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PREVIEWS))) await cache.delete(k)
}

/** The preview from the device, or null when it is not there yet. */
export async function cachedPreview(rec: MediaRecord): Promise<Blob | null> {
  const cache = await open()
  const res = await cache?.match(keyOf(rec))
  return res ? res.blob() : null
}

/** The preview, from the device or from Drive (then kept). */
export function loadPreview(rec: MediaRecord): Promise<Blob | null> {
  const pending = inflight.get(rec.id)
  if (pending) return pending
  const p = (async () => {
    const hit = await cachedPreview(rec)
    if (hit) return hit
    if (!navigator.onLine) return null
    const blob = await driveThumbnail(rec, PREVIEW_SIZE)
    if (!blob) return null
    const cache = await open()
    if (cache) {
      // Older versions of this photo are dropped.
      for (const k of await cache.keys(new Request(`${location.origin}/__preview/${encodeURIComponent(rec.id)}`), { ignoreSearch: true }))
        await cache.delete(k)
      await cache.put(keyOf(rec), new Response(blob, { headers: { 'Content-Type': blob.type } }))
      void trim(cache)
    }
    return blob
  })()
    .catch(() => null)
    .finally(() => inflight.delete(rec.id))
  inflight.set(rec.id, p)
  return p
}

/** Prepares the previews of the photos around the one on screen. */
export function prefetchPreviews(recs: (MediaRecord | undefined)[]) {
  for (const rec of recs) if (rec?.type === 'photo') void loadPreview(rec)
}

/** Removes the large previews and the videos kept on this device. */
export async function clearMediaCaches(): Promise<void> {
  try {
    await caches.delete(PREVIEW_CACHE)
    await caches.delete(VIDEO_CACHE)
  } catch {
    // nothing to clear
  }
}
