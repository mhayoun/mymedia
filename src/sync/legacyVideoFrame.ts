// The thumbnail of a video no browser decodes (3GP of old phones: H.263 / MPEG-4 Part 2; most AVI), made with
// ffmpeg.wasm on a computer: the video is downloaded from Drive, its picture at 1 second taken. ffmpeg (about
// 30 MB, served by MyMedia itself) is loaded only the first time such a video has no thumbnail. The thumbnail
// then goes into the thumbnail packs on Drive, so phones and the other devices never decode anything.

import type { FFmpeg } from '@ffmpeg/ffmpeg'
import type { MediaRecord } from '../db/db'
import { downloadBlob } from '../drive/api'

/** Above this, the video stays without a thumbnail (its whole file is downloaded to read it). */
const MAX_BYTES = 200 * 1024 * 1024
const AT_SECONDS = 1

let engine: Promise<FFmpeg> | null = null
/** ffmpeg could not start on this device: not tried again until MyMedia is opened again. */
let broken = false
/** One video at a time (one ffmpeg, one file system). */
let chain: Promise<unknown> = Promise.resolve()

const phone = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)

function load(): Promise<FFmpeg> {
  engine ??= (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const ffmpeg = new FFmpeg()
    const abs = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, location.href).href
    await ffmpeg.load({ coreURL: abs('ffmpeg/ffmpeg-core.js'), wasmURL: abs('ffmpeg/ffmpeg-core.wasm') })
    return ffmpeg
  })().catch((e) => {
    broken = true
    engine = null
    throw e
  })
  return engine
}

/** Whether this device makes such thumbnails (a computer; not a video too big to download). */
export function canMakeLegacyThumbnail(rec: Pick<MediaRecord, 'size'>): boolean {
  return !broken && !phone() && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && rec.size > 0 && rec.size <= MAX_BYTES
}

async function frame(ffmpeg: FFmpeg, input: string, at: number, size: number): Promise<Uint8Array | null> {
  const out = 'thumb.jpg'
  const code = await ffmpeg.exec([
    '-ss', String(at), '-i', input, '-frames:v', '1',
    '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`, '-q:v', '4', '-y', out,
  ])
  if (code !== 0) return null
  try {
    const data = await ffmpeg.readFile(out)
    await ffmpeg.deleteFile(out)
    return data instanceof Uint8Array && data.length > 0 ? data : null
  } catch {
    return null
  }
}

/** The picture at 1 second (at the start for a shorter video), as JPEG; null if it cannot be made here. */
export function legacyVideoThumbnail(rec: MediaRecord, size: number): Promise<Blob | null> {
  if (!canMakeLegacyThumbnail(rec)) return Promise.resolve(null)
  const job = chain.then(async () => {
    const ffmpeg = await load()
    const bytes = new Uint8Array(await (await downloadBlob(rec.id)).arrayBuffer())
    const input = `in.${rec.name.split('.').pop()?.toLowerCase() || 'bin'}`
    await ffmpeg.writeFile(input, bytes)
    try {
      const data = (await frame(ffmpeg, input, AT_SECONDS, size)) ?? (await frame(ffmpeg, input, 0, size))
      return data ? new Blob([data as BlobPart], { type: 'image/jpeg' }) : null
    } finally {
      await ffmpeg.deleteFile(input).catch(() => undefined)
    }
  })
  chain = job.catch(() => undefined)
  return job.catch((e) => {
    console.warn('[MyMedia] legacy video thumbnail failed', rec.name, e)
    return null
  })
}
