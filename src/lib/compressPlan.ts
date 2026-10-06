// Decides whether a media should be compressed, and estimates the result.
// Pure: unit-tested.

import type { MediaType, Origin } from './media'

export type KeepOriginal = 'version' | 'folder' | 'both'
export type VideoQuality = 'low' | 'medium' | 'high'

export interface CompressSettings {
  /** New big files found in Drive: propose a list (ask), compress silently (auto), or nothing (off). */
  autoMode: 'ask' | 'auto' | 'off'
  /** New photos found in Drive are considered when bigger than autoPhotoMinMB. */
  autoPhotos: boolean
  autoPhotoMinMB: number
  /** Same for videos (only on a computer able to encode H.264). */
  autoVideos: boolean
  autoVideoMinMB: number
  /** Automatic compression per origin (manual compression ignores this). */
  origins: Record<Origin, boolean>
  /** JPEG quality 0..1. */
  quality: number
  /** Longest side in pixels; 0 = unchanged. */
  maxDimension: number
  /** HEIC / PNG / WEBP photos are converted to JPEG (otherwise left alone). */
  convertToJpeg: boolean
  videoHeight: 720 | 1080
  videoQuality: VideoQuality
  keepOriginal: KeepOriginal
  /** Never compress below this size. */
  minSizeKB: number
  /** Keep the file unchanged if the saving is smaller than this (0..1). */
  minGain: number
}

export const DEFAULT_COMPRESS: CompressSettings = {
  autoMode: 'ask',
  autoPhotos: true,
  autoPhotoMinMB: 3,
  autoVideos: true,
  autoVideoMinMB: 50,
  origins: { camera: true, web: true, whatsapp: false, import: true, unknown: true },
  quality: 0.85,
  maxDimension: 3000,
  convertToJpeg: true,
  videoHeight: 1080,
  videoQuality: 'medium',
  keepOriginal: 'version',
  minSizeKB: 500,
  minGain: 0.15,
}

/** Video bitrates (bits/s) by output height and quality. */
export const VIDEO_BITRATES: Record<720 | 1080, Record<VideoQuality, number>> = {
  720: { low: 1_500_000, medium: 2_500_000, high: 4_000_000 },
  1080: { low: 3_000_000, medium: 5_000_000, high: 8_000_000 },
}
const AUDIO_BITRATE = 128_000

export type SkipReason =
  | 'compressedByApp'
  | 'tooSmall'
  | 'alreadyCompressed'
  | 'format'
  | 'videoNotHere'
  | 'noGain'
  | 'origin'
  | 'notBig'
  | 'old'

export interface PlanInput {
  name: string
  type: MediaType
  mimeType: string
  size: number
  width?: number
  height?: number
  durationMs?: number
  cameraMake?: string
  cameraModel?: string
  createdTime: string
  appProperties?: Record<string, string>
  origin: Origin
  /** JPEG quality read from the file's first bytes, if known. */
  jpegQuality?: number | null
}

export interface PlanContext {
  mode: 'auto' | 'manual'
  /** This device can re-encode videos. */
  videoSupported: boolean
  /** Automatic mode only handles files created after this date (ISO). */
  since?: string
}

export type Plan = { ok: true; estimate: number } | { ok: false; reason: SkipReason }

const REDUCED_SIZES = [1280, 1600, 2048, 2560]
const BYTES_PER_PIXEL: [number, number][] = [
  [0.7, 0.15],
  [0.8, 0.2],
  [0.85, 0.24],
  [0.9, 0.3],
  [1, 0.45],
]
const ALREADY_NAMES = /^(FB_IMG|received_|Screenshot|Screen ?Shot|Capture d.?[ée]cran|צילום מסך)|-WA\d+|WhatsApp/i

function bppFor(quality: number): number {
  return BYTES_PER_PIXEL.find(([q]) => quality <= q)?.[1] ?? 0.45
}

export function isJpegMime(mime: string, name: string): boolean {
  return mime === 'image/jpeg' || /\.jpe?g$/i.test(name)
}

export function photoEstimate(input: PlanInput, s: CompressSettings): number {
  const { width: w, height: h } = input
  if (!w || !h) return input.size * 0.5
  const long = Math.max(w, h)
  const scale = s.maxDimension && long > s.maxDimension ? s.maxDimension / long : 1
  return Math.round(w * h * scale * scale * bppFor(s.quality))
}

export function videoEstimate(input: PlanInput, s: CompressSettings): number {
  if (!input.durationMs) return input.size * 0.4
  return Math.round(((VIDEO_BITRATES[s.videoHeight][s.videoQuality] + AUDIO_BITRATE) * input.durationMs) / 8000)
}

export function planCompression(input: PlanInput, s: CompressSettings, ctx: PlanContext): Plan {
  if (input.appProperties?.mymedia_compressed) return { ok: false, reason: 'compressedByApp' }
  if (input.size < s.minSizeKB * 1024) return { ok: false, reason: 'tooSmall' }
  if (input.origin === 'whatsapp' || ALREADY_NAMES.test(input.name)) return { ok: false, reason: 'alreadyCompressed' }

  if (ctx.mode === 'auto') {
    if (!s.origins[input.origin]) return { ok: false, reason: 'origin' }
    if (ctx.since && input.createdTime < ctx.since) return { ok: false, reason: 'old' }
    const min = (input.type === 'photo' ? s.autoPhotoMinMB : s.autoVideoMinMB) * 1024 * 1024
    if (input.size < min) return { ok: false, reason: 'notBig' }
    if (input.type === 'photo' && !s.autoPhotos) return { ok: false, reason: 'notBig' }
    if (input.type === 'video' && !s.autoVideos) return { ok: false, reason: 'notBig' }
  }

  let estimate: number
  if (input.type === 'photo') {
    const jpeg = isJpegMime(input.mimeType, input.name)
    if (!jpeg && !s.convertToJpeg) return { ok: false, reason: 'format' }
    const long = Math.max(input.width ?? 0, input.height ?? 0)
    const willResize = !!s.maxDimension && long > s.maxDimension
    if (jpeg && !willResize) {
      const pixels = (input.width ?? 0) * (input.height ?? 0)
      const hasCamera = !!(input.cameraMake || input.cameraModel)
      if (input.jpegQuality != null && input.jpegQuality <= 85) return { ok: false, reason: 'alreadyCompressed' }
      if (pixels && input.size / pixels < 0.15) return { ok: false, reason: 'alreadyCompressed' }
      if (!hasCamera && REDUCED_SIZES.some((r) => Math.abs(long - r) <= 1)) return { ok: false, reason: 'alreadyCompressed' }
    }
    estimate = photoEstimate(input, s)
  } else {
    if (!ctx.videoSupported) return { ok: false, reason: 'videoNotHere' }
    const short = Math.min(input.width ?? Infinity, input.height ?? Infinity)
    const target = VIDEO_BITRATES[s.videoHeight][s.videoQuality]
    if (input.durationMs && short <= s.videoHeight) {
      const bitrate = (input.size * 8000) / input.durationMs
      if (bitrate <= (target + AUDIO_BITRATE) * 1.15) return { ok: false, reason: 'alreadyCompressed' }
    }
    estimate = videoEstimate(input, s)
  }
  if (estimate > input.size * (1 - s.minGain)) return { ok: false, reason: 'noGain' }
  return { ok: true, estimate }
}
