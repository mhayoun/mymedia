// Picture for a video when Google Drive has no thumbnail for it: decodes one
// frame directly from Drive, reading only the bytes it needs (file index +
// first images), never the whole video.

import type { MediaRecord } from '../db/db'
import { downloadRange } from '../drive/api'

/** Seconds into the video: just after the start, to avoid a black fade-in frame. */
const FRAME_AT = 1

export async function videoFrameThumbnail(rec: MediaRecord, size: number): Promise<Blob | null> {
  if (typeof VideoDecoder === 'undefined' || rec.size <= 0) return null
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
    if (!track || !(await track.canDecode())) return null
    const first = await track.getFirstTimestamp()
    const duration = await track.computeDuration()
    const at = first + Math.min(FRAME_AT, Math.max(0, (duration - first) / 2))
    const landscape = track.displayWidth >= track.displayHeight
    const sink = new CanvasSink(track, landscape ? { width: size } : { height: size })
    const frame = await sink.getCanvas(at)
    if (!frame) return null
    const canvas = frame.canvas
    if (canvas instanceof OffscreenCanvas) return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  } catch (e) {
    console.warn('[MyMedia] video frame failed', rec.name, e)
    return null
  } finally {
    input.dispose()
  }
}
