/// <reference lib="webworker" />
// Re-encodes a photo as JPEG (resized, chosen quality) off the main thread,
// and puts the original EXIF (date, camera, GPS…) back into the result.

import { insertExif, resetOrientation } from '../lib/jpeg'

export interface PhotoJob {
  source: Blob | ImageBitmap
  exif: Uint8Array | null
  quality: number
  maxDimension: number
}

export interface PhotoResult {
  blob: Blob
  width: number
  height: number
}

async function compress(job: PhotoJob): Promise<PhotoResult> {
  // createImageBitmap applies the EXIF orientation: pixels come out upright.
  const bitmap = job.source instanceof Blob ? await createImageBitmap(job.source) : job.source
  const long = Math.max(bitmap.width, bitmap.height)
  const scale = job.maxDimension && long > job.maxDimension ? job.maxDimension / long : 1
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff' // transparent PNG areas become white, not black
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  let blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: job.quality })
  if (job.exif) {
    const bytes = insertExif(new Uint8Array(await blob.arrayBuffer()), resetOrientation(job.exif))
    blob = new Blob([bytes as BlobPart], { type: 'image/jpeg' })
  }
  return { blob, width, height }
}

self.onmessage = async (e: MessageEvent<{ id: number; job: PhotoJob }>) => {
  try {
    self.postMessage({ id: e.data.id, result: await compress(e.data.job) })
  } catch (err) {
    self.postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) })
  }
}
