// Photo and video re-encoding (used by the compression engine).

import type { MediaRecord } from '../db/db'
import { downloadRange } from '../drive/api'
import { VIDEO_BITRATES, type CompressSettings } from '../lib/compressPlan'
import { heicExif, jpegExif } from '../lib/jpeg'
import type { PhotoJob, PhotoResult } from './photo.worker'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (r: PhotoResult) => void; reject: (e: Error) => void }>()

function photoWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./photo.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; result?: PhotoResult; error?: string }>) => {
      const p = pending.get(e.data.id)
      pending.delete(e.data.id)
      if (e.data.error) p?.reject(new Error(e.data.error))
      else p?.resolve(e.data.result!)
    }
  }
  return worker
}

type Named = Pick<MediaRecord, 'name' | 'mimeType'>

function isHeic(rec: Named): boolean {
  return /hei[cf]/i.test(rec.mimeType) || /\.hei[cf]$/i.test(rec.name)
}

export async function compressPhoto(rec: Named, original: Blob, s: CompressSettings): Promise<Blob> {
  const bytes = new Uint8Array(await original.arrayBuffer())
  let source: Blob | ImageBitmap = original
  let exif: Uint8Array | null
  if (isHeic(rec)) {
    exif = heicExif(bytes)
    try {
      source = await createImageBitmap(original) // Safari reads HEIC natively
    } catch {
      const { heicTo } = await import('heic-to') // elsewhere: libheif (WebAssembly)
      source = await heicTo({ blob: original, type: 'bitmap' })
    }
  } else exif = jpegExif(bytes)
  const job: PhotoJob = { source, exif, quality: s.quality, maxDimension: s.maxDimension }
  const id = nextId++
  const result = await new Promise<PhotoResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    photoWorker().postMessage({ id, job }, source instanceof ImageBitmap ? [source] : [])
  })
  return result.blob
}

let videoCheck: Promise<boolean> | null = null

/** True on a computer whose browser can encode H.264 video. */
export function canCompressVideo(): Promise<boolean> {
  videoCheck ??= (async () => {
    const ua = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
    const mobile = ua.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    if (mobile || typeof VideoEncoder === 'undefined') return false
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 5_000_000 })
      return !!r.supported
    } catch {
      return false
    }
  })()
  return videoCheck
}

/**
 * Re-encodes a video to H.264/AAC MP4. The original is either a Drive file
 * (read piece by piece) or a local file being imported.
 */
export async function compressVideo(
  from: MediaRecord | Blob,
  s: CompressSettings,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, CustomSource, Input, Mp4OutputFormat, Output } = await import('mediabunny')
  const input = new Input({
    formats: ALL_FORMATS,
    source:
      from instanceof Blob
        ? new BlobSource(from)
        : new CustomSource({
            getSize: () => from.size,
            read: (start, end) => downloadRange(from.id, start, end),
            prefetchProfile: 'network',
          }),
  })
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const bitrate = VIDEO_BITRATES[s.videoHeight][s.videoQuality]
  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: (track) => {
        const landscape = track.displayWidth >= track.displayHeight
        const short = Math.min(track.displayWidth, track.displayHeight)
        const resize = short > s.videoHeight ? (landscape ? { height: s.videoHeight } : { width: s.videoHeight }) : {}
        return { codec: 'avc', bitrate, forceTranscode: true, ...resize }
      },
      // AAC sound is copied as is (most phone videos); other formats are converted to AAC.
      audio: (track) => (track.codec === 'aac' ? {} : { codec: 'aac', bitrate: 128_000 }),
      tags: (tags) => tags, // keep creation date, location…
    })
    if (!conversion.isValid) throw new Error('video format not supported')
    // Never produce a silent video: if the sound cannot be kept, leave the file alone.
    if (conversion.discardedTracks.some((d) => d.track.type === 'audio')) throw new Error('the sound of this video cannot be kept')
    conversion.onProgress = onProgress
    const stop = () => void conversion.cancel()
    signal.addEventListener('abort', stop, { once: true })
    try {
      await conversion.execute()
    } finally {
      signal.removeEventListener('abort', stop)
    }
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    return new Blob([target.buffer!], { type: 'video/mp4' })
  } finally {
    input.dispose()
  }
}

/** Duration of a local video file in milliseconds, or undefined. */
export async function localVideoDuration(file: Blob): Promise<number | undefined> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny')
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
    try {
      return Math.round((await input.computeDuration()) * 1000)
    } finally {
      input.dispose()
    }
  } catch {
    return undefined
  }
}
