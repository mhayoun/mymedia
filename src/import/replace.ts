// Facebook export: photos that Katia reduced (folders imported into Katia by
// hand: 1600 px, JPEG 72 %) are found again in the ZIP — by file name, else
// by look — and can be replaced by the ZIP's version. The Drive file keeps
// its id, so species, album, date and description stay; Drive keeps the
// reduced version as an older version of the file.

import { db, type MediaRecord } from '../db/db'
import { uploadNewContent } from '../drive/api'
import { cosine } from '../lib/classifier'
import type { ImportInfo } from '../lib/provenance'
import { mediaVersion } from '../ml/indexStore'
import { embed } from '../ml/ml'
import { toRecord } from '../sync/engine'
import { driveThumbnail } from '../sync/thumbs'
import type { ImportItem } from './importer'

/** Same picture: fingerprints this close, and the same shape. */
const SAME_PICTURE = 0.92
const SAME_SHAPE = 0.03
/** The ZIP's file must be clearly bigger than the one in Drive. */
const MIN_GAIN = 1.05
const FINGERPRINT_SIZE = 512

export interface Replacement {
  id: string
  name: string
  size: number
  by: 'name' | 'look'
}

const shape = (w?: number, h?: number) => (w && h ? Math.max(w, h) / Math.min(w, h) : null)

/** The picture at fingerprint size, and its dimensions. */
async function readPicture(file: Blob): Promise<{ small: Blob; ratio: number } | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, FINGERPRINT_SIZE / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const ratio = shape(bitmap.width, bitmap.height)!
    bitmap.close()
    return { small: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), ratio }
  } catch {
    return null
  }
}

async function fingerprintOf(rec: MediaRecord): Promise<Int8Array | null> {
  const stored = await db().embeddings.get(rec.id)
  if (stored?.vec && stored.version === mediaVersion(rec)) return stored.vec
  const thumb = await driveThumbnail(rec, FINGERPRINT_SIZE)
  return thumb ? embed([thumb]) : null
}

/**
 * Marks the ZIP photos that are a better version of a photo reduced by Katia
 * (`replaces`). Matching by name first, then by look (closest pairs first,
 * each photo used once). A photo found by look that is not clearly bigger is
 * a duplicate (`sameLook`).
 */
export async function findReplacements(items: ImportItem[], onProgress: (done: number, total: number) => void): Promise<ImportItem[]> {
  const d = db()
  const media = (await d.media.toArray()).filter((m) => m.type === 'photo')
  const metas = new Map((await d.meta.bulkGet(media.map((m) => m.id))).filter((m) => !!m).map((m) => [m.id, m]))
  const reduced = media.filter((m) => metas.get(m.id)?.imported?.via === 'katia')
  const byName = new Map(media.map((m) => [m.name, m]))
  const taken = new Set<string>()
  const out = [...items]
  const better = (item: ImportItem, rec: MediaRecord) => item.file.size >= rec.size * MIN_GAIN

  // 1. Same file name, smaller in Drive.
  out.forEach((item, i) => {
    if (item.type !== 'photo' || !item.extra) return
    const rec = byName.get(item.file.name)
    if (rec && !taken.has(rec.id) && better(item, rec)) {
      taken.add(rec.id)
      out[i] = { ...item, duplicate: false, replaces: { id: rec.id, name: rec.name, size: rec.size, by: 'name' } }
    }
  })

  // 2. Same picture, among the photos Katia reduced.
  const todo = out.map((item, i) => ({ item, i })).filter(({ item }) => item.type === 'photo' && item.extra && !item.replaces && !item.duplicate)
  const candidates = reduced.filter((r) => !taken.has(r.id))
  if (!todo.length || !candidates.length) return out
  const total = todo.length + candidates.length
  let done = 0
  try {
    const cand: { rec: MediaRecord; vec: Int8Array }[] = []
    for (const rec of candidates) {
      const vec = await fingerprintOf(rec).catch(() => null)
      if (vec) cand.push({ rec, vec })
      onProgress(++done, total)
    }
    const pairs: { i: number; rec: MediaRecord; sim: number }[] = []
    for (const { item, i } of todo) {
      const pic = await readPicture(item.file)
      const vec = pic ? await embed([pic.small]) : null
      onProgress(++done, total)
      if (!pic || !vec) continue
      for (const c of cand) {
        const r = shape(c.rec.width, c.rec.height)
        if (r && Math.abs(r - pic.ratio) / pic.ratio > SAME_SHAPE) continue
        const sim = cosine(vec, c.vec)
        if (sim >= SAME_PICTURE) pairs.push({ i, rec: c.rec, sim })
      }
    }
    pairs.sort((a, b) => b.sim - a.sim)
    const used = new Set<number>()
    for (const p of pairs) {
      if (used.has(p.i) || taken.has(p.rec.id)) continue
      used.add(p.i)
      taken.add(p.rec.id)
      // Not clearly better: the same photo is already in Drive, nothing to send.
      out[p.i] = better(out[p.i], p.rec)
        ? { ...out[p.i], replaces: { id: p.rec.id, name: p.rec.name, size: p.rec.size, by: 'look' } }
        : { ...out[p.i], duplicate: true, sameLook: true }
    }
  } catch (e) {
    console.warn('[MyMedia] matching by look not available', e)
  }
  return out
}

/** Puts the ZIP's file in place of the reduced one (same Drive file). Returns the new size. */
export async function replaceContent(
  item: ImportItem,
  imported: ImportInfo,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<number> {
  const d = db()
  const rec = await d.media.get(item.replaces!.id)
  if (!rec) throw new Error('media no longer in Drive')
  const updated = await uploadNewContent(
    rec.id,
    item.file,
    { mimeType: item.mimeType, appProperties: { mymedia_compressed: null, mymedia_quality: null, mymedia_original_size: null } },
    onProgress,
    signal,
  )
  const fresh = toRecord(updated) ?? { ...rec, size: item.file.size }
  await d.media.put({ ...fresh, folderId: rec.folderId, takenAt: rec.takenAt })
  // Same picture: its fingerprint and faces stay valid.
  const emb = await d.embeddings.get(rec.id)
  if (emb?.vec) await d.embeddings.put({ ...emb, version: mediaVersion(fresh) })
  if (await d.faceScans.get(rec.id)) {
    await d.faceScans.put({ id: rec.id, version: mediaVersion(fresh) })
    await d.faces.where('mediaId').equals(rec.id).modify({ version: mediaVersion(fresh), updatedAt: Date.now() })
    await d.setKv('facesDirty', true)
  }
  const meta = await d.meta.get(rec.id)
  if (meta)
    await d.meta.put({
      ...meta,
      group: meta.group ?? item.extra?.group,
      description: meta.description || item.extra?.description,
      imported,
      compression: undefined,
      updatedAt: Date.now(),
    })
  return item.file.size
}
