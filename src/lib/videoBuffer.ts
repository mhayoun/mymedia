// Videos on a slow connection: playing starts once the rest will arrive
// before it is needed, so the video does not stop and go.

/** The channel the service worker tells how much of a playing video has arrived. */
export const VIDEO_CHANNEL = 'mymedia-video'

export interface VideoProgress {
  id: string
  loaded: number
  size: number
}

/** Downloads at this share of the measured speed, to be safe. */
const MARGIN = 0.85

/**
 * Bytes to have before playing: the rest, downloading at `rate` (bytes/s)
 * while the video plays for `durationS`, must arrive in time.
 */
export function bytesBeforePlay(size: number, rate: number, durationS: number): number {
  if (!(durationS > 0) || !(rate > 0)) return size
  return Math.min(size, Math.max(0, size - MARGIN * rate * durationS))
}
