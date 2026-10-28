// Turning photos a quarter turn. The same Drive file gets the new content, so
// its album, date, species, text and people stay; only the EXIF orientation
// changes (lossless).

import { db, type MediaRecord } from '../db/db'
import { uploadNewContent } from '../drive/api'
import { markFacesDirty } from '../faces/store'
import { turnBox } from '../lib/faces'
import { rotateJpeg } from '../lib/jpeg'
import { mediaVersion } from '../ml/indexStore'
import { keepOriginal, loadOriginal } from './previews'
import { toRecord } from './engine'
import { replaceThumbUrl, thumbVersion } from './thumbs'

/** Only JPEG photos can be turned without re-encoding them. */
export function canRotate(rec: MediaRecord): boolean {
  return rec.type === 'photo' && /^image\/jpe?g$/i.test(rec.mimeType)
}

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

export function rotateMedia(id: string, turns: 1 | -1): Promise<void> {
  const run = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => turn(id, turns))
  queues.set(id, run)
  void run.finally(() => queues.get(id) === run && queues.delete(id)).catch(() => undefined)
  return run
}

async function turn(id: string, turns: 1 | -1): Promise<void> {
  const d = db()
  const rec = await d.media.get(id)
  if (!rec) throw new Error('media no longer in Drive')
  if (!canRotate(rec)) throw new Error('not a JPEG photo')
  const original = await loadOriginal(rec, () => undefined, new AbortController().signal)
  const bytes = rotateJpeg(new Uint8Array(await original.arrayBuffer()), turns)
  if (!bytes) throw new Error('not a JPEG photo')
  const blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' })
  const updated = await uploadNewContent(rec.id, blob, {
    appProperties: {
      // The date shown stays the same whatever reads the file.
      mymedia_taken: rec.takenAt,
      // The same photo imported again is still known as a duplicate.
      ...(rec.appProperties?.mymedia_source_md5 || rec.md5 ? { mymedia_source_md5: rec.appProperties?.mymedia_source_md5 ?? rec.md5! } : {}),
    },
  })
  const fresh: MediaRecord = { ...(toRecord(updated) ?? { ...rec, size: blob.size }), folderId: rec.folderId, takenAt: rec.takenAt }

  // The thumbnail and the full photo of this device, turned at once (no download).
  const thumb = await d.thumbs.get(id)
  const turned = thumb ? await turnImage(thumb.blob, turns) : null
  if (turned) await d.thumbs.put({ id, version: thumbVersion(fresh), blob: turned })
  replaceThumbUrl(id, turned)
  await keepOriginal(fresh, blob)

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
