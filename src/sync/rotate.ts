// Turning photos and videos a quarter turn. The same Drive file gets the new
// content, so its album, date, species, text and people stay; only the EXIF
// orientation (photos) or the track matrix (MP4 / MOV videos) changes: lossless.

import { db, type MediaRecord } from '../db/db'
import { downloadBlob, uploadNewContent } from '../drive/api'
import { markFacesDirty } from '../faces/store'
import { turnBox } from '../lib/faces'
import { rotateJpeg } from '../lib/jpeg'
import { MAX_ROTATE_VIDEO, rotateMp4 } from '../lib/mp4Rotate'
import { mediaVersion } from '../ml/indexStore'
import { keepOriginal, loadOriginal } from './previews'
import { toRecord } from './engine'
import { replaceThumbUrl, thumbVersion } from './thumbs'

const MP4 = /^video\/(mp4|quicktime|3gpp2?|x-m4v)$/i

/** Why it cannot be turned without re-encoding it (i18n key), or null when it can. */
export function cannotRotate(rec: MediaRecord): string | null {
  if (rec.type === 'photo') return /^image\/jpe?g$/i.test(rec.mimeType) ? null : 'rotate.onlyJpeg'
  if (!MP4.test(rec.mimeType)) return 'rotate.onlyMp4'
  return rec.size > MAX_ROTATE_VIDEO ? 'rotate.tooBig' : null
}

export const canRotate = (rec: MediaRecord) => cannotRotate(rec) === null

/** The thumbnail turned like its photo (its pixels are upright already). */
async function turnImage(blob: Blob, turns: 1 | -1): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.height, bitmap.width)
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((turns * Math.PI) / 2)
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  } catch {
    return null
  }
}

/** One turn at a time per photo: a second tap waits for the first to be saved. */
const queues = new Map<string, Promise<unknown>>()

/** `onProgress`: share of a video downloaded then uploaded again (0 to 1). */
export function rotateMedia(id: string, turns: 1 | -1, onProgress?: (p: number) => void): Promise<void> {
  const run = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => turn(id, turns, onProgress))
  queues.set(id, run)
  void run.finally(() => queues.get(id) === run && queues.delete(id)).catch(() => undefined)
  return run
}

/** The photo or video turned (not kept: a video is too big for the cache). */
async function turnedContent(rec: MediaRecord, turns: 1 | -1, onProgress?: (p: number) => void): Promise<Blob> {
  if (rec.type === 'photo') {
    const original = await loadOriginal(rec, () => undefined, new AbortController().signal)
    const bytes = rotateJpeg(new Uint8Array(await original.arrayBuffer()), turns)
    if (!bytes) throw new Error('not a JPEG photo')
    return new Blob([bytes as BlobPart], { type: 'image/jpeg' })
  }
  const video = await downloadBlob(rec.id, (p) => onProgress?.(p / 2))
  const blob = await rotateMp4(video, turns)
  if (!blob) throw new Error('not an MP4 / MOV video')
  return blob
}

async function turn(id: string, turns: 1 | -1, onProgress?: (p: number) => void): Promise<void> {
  const d = db()
  const rec = await d.media.get(id)
  if (!rec) throw new Error('media no longer in Drive')
  const reason = cannotRotate(rec)
  if (reason) throw new Error(reason)
  const blob = await turnedContent(rec, turns, onProgress)
  const updated = await uploadNewContent(rec.id, blob, {
    appProperties: {
      // The date shown stays the same whatever reads the file.
      mymedia_taken: rec.takenAt,
      // The same photo imported again is still known as a duplicate.
      ...(rec.appProperties?.mymedia_source_md5 || rec.md5 ? { mymedia_source_md5: rec.appProperties?.mymedia_source_md5 ?? rec.md5! } : {}),
    },
    mimeType: rec.mimeType,
  }, (p) => onProgress?.(rec.type === 'video' ? 0.5 + p / 2 : p))
  const fresh: MediaRecord = { ...(toRecord(updated) ?? { ...rec, size: blob.size }), folderId: rec.folderId, takenAt: rec.takenAt }

  // The thumbnail and the full photo of this device, turned at once (no download).
  const thumb = await d.thumbs.get(id)
  const turned = thumb ? await turnImage(thumb.blob, turns) : null
  if (turned) await d.thumbs.put({ id, version: thumbVersion(fresh), blob: turned })
  replaceThumbUrl(id, turned)
  if (rec.type === 'photo') await keepOriginal(fresh, blob)

  // The faces turn with the photo and keep their person; the fingerprint is made again (the picture changed).
  const version = mediaVersion(fresh)
  const faces = await d.faces.where('mediaId').equals(id).toArray()
  if (faces.length || (await d.faceScans.get(id))) {
    const now = Date.now()
    await d.transaction('rw', [d.faces, d.faceScans], async () => {
      await d.faces.bulkPut(faces.map((f) => ({ ...f, box: turnBox(f.box, turns), version, updatedAt: now })))
      await d.faceScans.put({ id, version })
    })
    await markFacesDirty()
  }
  await d.media.put(fresh)
}
