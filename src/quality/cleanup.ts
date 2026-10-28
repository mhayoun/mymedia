// Finding photos to clean up: those that look alike (duplicates) and the
// blurred ones. Both work from what the device already has: the
// fingerprints of the analysed photos, and the thumbnails.

import { inReservedFolder, loadData } from '../classify/data'
import { db, type MediaRecord } from '../db/db'
import { pairKey, MIN_SIMILAR, type Pair } from '../lib/similar'
import { mediaVersion } from '../ml/indexStore'
import { sharpnessIn, similarIn } from '../ml/ml'
import { EMBED_DIM } from '../ml/protocol'
import { loadPack, packOf } from '../sync/thumbPacks'
import { thumbVersion } from '../sync/thumbs'

/** Pairs the user said are not duplicates (this account, every device of it uses its own). */
export const NOT_DUPLICATES_KEY = 'notDuplicates'
/** Photos the user said are not blurred. */
export const NOT_BLURRY_KEY = 'notBlurry'
const SHARPNESS_KEY = 'sharpness'

export interface DuplicateSearch {
  pairs: Pair[]
  /** Photos compared (analysed). */
  compared: number
  /** Photos not analysed yet: not compared. */
  waiting: number
}

const isPhoto = (data: Awaited<ReturnType<typeof loadData>>) => (r: MediaRecord) =>
  r.type === 'photo' && !inReservedFolder(r.folderId, data)

/** Same file (same content, or the same original before compression), then same look. */
export async function findDuplicates(rootId: string): Promise<DuplicateSearch> {
  const data = await loadData(rootId)
  const photos = data.media.filter(isPhoto(data))
  const best = new Map<string, Pair>()
  const add = (p: Pair) => {
    const k = pairKey(p.a, p.b)
    if ((best.get(k)?.score ?? 0) < p.score) best.set(k, p)
  }

  const byContent = new Map<string, string[]>()
  for (const r of photos) {
    for (const md5 of new Set([r.md5, r.appProperties?.mymedia_source_md5])) {
      if (!md5) continue
      const list = byContent.get(md5) ?? []
      list.push(r.id)
      byContent.set(md5, list)
    }
  }
  for (const ids of byContent.values()) for (let i = 1; i < ids.length; i++) add({ a: ids[0], b: ids[i], score: 1 })

  const withVec = photos.filter((r) => data.vecs.has(r.id))
  const dim = withVec.length ? data.vecs.get(withVec[0].id)!.length : EMBED_DIM
  const packed = new Int8Array(withVec.length * dim)
  withVec.forEach((r, i) => packed.set(data.vecs.get(r.id)!, i * dim))
  const ids = withVec.map((r) => r.id)
  if (ids.length >= 2) for (const p of await similarIn({ ids, labels: [], dim, data: packed }, MIN_SIMILAR)) add(p)

  return { pairs: [...best.values()], compared: withVec.length, waiting: photos.length - withVec.length }
}

/** A thumbnail already made: on the device, else in its pack (never Google's preview, which cannot be read). */
async function madeThumbnail(rec: MediaRecord, stored: { version: string; blob: Blob } | undefined): Promise<Blob | null> {
  const ok = (s?: { version: string }) => !!s && (s.version === thumbVersion(rec) || s.version === rec.modifiedTime)
  if (stored && ok(stored)) return stored.blob
  const pack = packOf(rec.id)
  if (!pack) return null
  const s = (await loadPack(pack.key)).get(rec.id)
  return s && ok(s) ? s.blob : null
}

export interface BlurSearch {
  /** Photo id → sharpness (low = blurred). */
  scores: Map<string, number>
  /** Photos without a thumbnail on this device yet: not measured. */
  missing: number
}

const CHUNK = 40

/** Measures the sharpness of every photo (kept on the device: only new photos are measured again). */
export async function measureSharpness(rootId: string, onProgress: (done: number, total: number) => void, signal: { cancelled: boolean }): Promise<BlurSearch> {
  const data = await loadData(rootId)
  const photos = data.media.filter(isPhoto(data))
  const d = db()
  const cache = (await d.getKv<Record<string, [string, number]>>(SHARPNESS_KEY)) ?? {}
  const scores = new Map<string, number>()
  const todo: MediaRecord[] = []
  for (const r of photos) {
    const c = cache[r.id]
    if (c && c[0] === mediaVersion(r)) scores.set(r.id, c[1])
    else todo.push(r)
  }
  let missing = 0
  let done = 0
  onProgress(0, todo.length)
  for (let i = 0; i < todo.length && !signal.cancelled; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK)
    const stored = await d.thumbs.bulkGet(chunk.map((r) => r.id))
    const blobs = await Promise.all(chunk.map((r, j) => madeThumbnail(r, stored[j]).catch(() => null)))
    const have = chunk.filter((_, j) => blobs[j])
    missing += chunk.length - have.length
    const measured = have.length ? await sharpnessIn(blobs.filter((b): b is Blob => !!b)) : []
    have.forEach((r, j) => {
      const s = measured[j]
      if (s == null) return
      scores.set(r.id, s)
      cache[r.id] = [mediaVersion(r), s]
    })
    done += chunk.length
    onProgress(done, todo.length)
    if ((i / CHUNK) % 10 === 9) await d.setKv(SHARPNESS_KEY, cache)
  }
  // Removed photos are forgotten.
  const ids = new Set(photos.map((r) => r.id))
  for (const id of Object.keys(cache)) if (!ids.has(id)) delete cache[id]
  await d.setKv(SHARPNESS_KEY, cache)
  return { scores, missing }
}
