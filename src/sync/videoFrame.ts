// Pictures from a video, decoded directly from Drive: only the bytes needed
// (file index + a few images) are read, never the whole video.

import type { MediaRecord } from '../db/db'
import { downloadRange } from '../drive/api'

/** Seconds into the video for its thumbnail: just after the start, to avoid a black fade-in frame. */
const THUMB_AT = 1

type Times = (first: number, duration: number) => number[]

/** Frames at the times returned by `times` (in seconds), as JPEG blobs. */
export async function videoFrames(rec: MediaRecord, times: Times, size: number): Promise<Blob[]> {
  if (typeof VideoDecoder === 'undefined' || rec.size <= 0) return []
  // Loaded only when needed: keeps the app small at start-up.
  const { ALL_FORMATS, CanvasSink, CustomSource, Input } = await import('mediabunny')
  const input = new Input({
    formats: ALL_FORMATS,
    source: new CustomSource({
      getSize: () => rec.size,
      read: (start, end) => downloadRange(rec.id, start, end),
      prefetchProfile: 'network',
    }),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) return []
    const first = await track.getFirstTimestamp()
    const duration = await track.computeDuration()
    const landscape = track.displayWidth >= track.displayHeight
    const sink = new CanvasSink(track, landscape ? { width: size } : { height: size })
    const blobs: Blob[] = []
    for (const t of times(first, duration)) {
      const frame = await sink.getCanvas(t)
      if (!frame) continue
      const canvas = frame.canvas
      const blob =
        canvas instanceof OffscreenCanvas
          ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
          : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (blob) blobs.push(blob)
    }
    return blobs
  } catch (e) {
    console.warn('[MyMedia] video frames failed', rec.name, e)
    return []
  } finally {
    input.dispose()
  }
}

export async function videoFrameThumbnail(rec: MediaRecord, size: number): Promise<Blob | null> {
  const [blob] = await videoFrames(rec, (first, duration) => [first + Math.min(THUMB_AT, Math.max(0, (duration - first) / 2))], size)
  return blob ?? null
}

/** Start, middle and end frames, used to recognise what a video shows. */
export function videoKeyFrames(rec: MediaRecord, size: number): Promise<Blob[]> {
  return videoFrames(rec, (first, duration) => {
    const len = Math.max(0, duration - first)
    return [first + Math.min(THUMB_AT, len * 0.1), first + len * 0.5, first + len * 0.9]
  }, size)
}
