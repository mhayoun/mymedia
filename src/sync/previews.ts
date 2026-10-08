// Large previews (photo viewer): Drive's preview at screen size, kept on the
// device so a photo opens at once the second time. The neighbours of the
// photo on screen are prepared in advance, so swiping is instant too.

import type { MediaRecord } from '../db/db'
import { downloadBlob } from '../drive/api'
import { driveThumbnail, thumbVersion } from './thumbs'

export const PREVIEW_CACHE = 'mymedia-previews'
export const VIDEO_CACHE = 'mymedia-videos'
const PREVIEW_SIZE = 2048
/** About 300 previews (≈ 100–150 MB); the oldest are removed first. */
const MAX_PREVIEWS = 300
/** Small photos are shown from the original: sharper than Drive's preview, and hardly bigger. */
const ORIGINAL_UNDER = 2 * 1024 * 1024
/** When Drive has no preview, originals up to this size are shown instead. */
const ORIGINAL_FALLBACK_MAX = 25 * 1024 * 1024

/** Formats every browser can show (not HEIC). */
const showable = (rec: MediaRecord) => /^image\/(jpeg|png|webp|gif)$/i.test(rec.mimeType)

async function fromOriginal(rec: MediaRecord): Promise<Blob | null> {
  try {
    const b = await downloadBlob(rec.id)
    return b.type.startsWith('image/') ? b : new Blob([b], { type: rec.mimeType })
  } catch {
    return null
  }
}

const inflight = new Map<string, Promise<Blob | null>>()

// "o1": previews made after small photos started coming from the original.
const keyOf = (rec: MediaRecord) => new Request(`${location.origin}/__preview/${encodeURIComponent(rec.id)}?v=${encodeURIComponent(thumbVersion(rec))}&o1`)

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
    const small = showable(rec) && rec.size > 0 && rec.size <= ORIGINAL_UNDER
    let blob = small ? await fromOriginal(rec) : null
    blob ??= await driveThumbnail(rec, PREVIEW_SIZE)
    if (!blob && showable(rec) && rec.size <= ORIGINAL_FALLBACK_MAX) {
      console.warn('[MyMedia] no Drive preview, showing the original', rec.name)
      blob = await fromOriginal(rec)
    }
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
