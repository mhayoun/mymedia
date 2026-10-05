// Pure helpers about media files: type detection, dates, origin.

export type MediaType = 'photo' | 'video'
export type Origin = 'web' | 'whatsapp' | 'camera' | 'import' | 'unknown'

export const ORIGINS: Origin[] = ['camera', 'whatsapp', 'web', 'import', 'unknown']

const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime'])
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'])
const VIDEO_EXT = new Set(['mp4', 'mov'])

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export function extension(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? name : name.slice(0, i)
}

/** Returns the media type of a supported file, or null for anything else. */
export function mediaTypeOf(mimeType: string, name: string): MediaType | null {
  if (PHOTO_MIME.has(mimeType)) return 'photo'
  if (VIDEO_MIME.has(mimeType)) return 'video'
  // Drive sometimes reports HEIC/MOV as application/octet-stream.
  const ext = extension(name)
  if (PHOTO_EXT.has(ext)) return 'photo'
  if (VIDEO_EXT.has(ext)) return 'video'
  return null
}

/** Drive's imageMediaMetadata.time uses EXIF format "YYYY:MM:DD HH:MM:SS". */
export function parseExifDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim())
  if (!m) return undefined
  const [, y, mo, d, h, mi, s] = m
  if (y === '0000') return undefined
  return validIso(`${y}-${mo}-${d}T${h}:${mi}:${s}`)
}

/** Date embedded in automatic file names (WhatsApp, Pixel, Samsung, Android). */
export function dateFromFileName(name: string): string | undefined {
  // IMG-20260105-WA0001, VID-20260105-WA0001
  let m = /(?:^|[^\d])(20\d{2}|19\d{2})(\d{2})(\d{2})-WA\d+/i.exec(name)
  if (m) return validIso(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
  // 20260105_143022, IMG_20260105_143022, PXL_20260105_143022123, Screenshot_20260105-143022
  m = /(?:^|[^\d])(20\d{2}|19\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/.exec(name)
  if (m) return validIso(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`)
  return undefined
}

function validIso(local: string): string | undefined {
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return undefined
  const [datePart] = local.split('T')
  const [y, mo, day] = datePart.split('-').map(Number)
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || y < 1900) return undefined
  return local
}

export const WHATSAPP_NAME = /^(IMG|VID|AUD|PTT|STK)-\d{8}-WA\d+/i
const SCREENSHOT_NAME = /screenshot|screen[ _-]?shot|צילום[ _-]?מסך|capture[ _-]d.?[ée]cran/i
const CAMERA_NAMES = [
  /^(IMG|VID)_\d{8}_\d{6}/i, // Android
  /^PXL_\d{8}_\d+/i, // Pixel
  /^\d{8}_\d{6}/, // Samsung
  /^IMG_\d{4}\b/i, // iPhone / Canon
  /^(IMG|MVI|MOV)_\d{3,}/i,
  /^DSC[_F]?\d{3,}/i, // Sony / Nikon
  /^DJI_\d+/i,
  /^GOPR?\d+/i,
  /^P\d{7}/, // Panasonic / Olympus
]

export interface OriginInput {
  name: string
  type: MediaType
  cameraMake?: string
  cameraModel?: string
  /** Folder path inside or outside the root, e.g. "WhatsApp Images". */
  folderPath?: string
}

/**
 * Best-effort origin detection. It is a heuristic: the user can always
 * correct it, and a manual value is never overwritten.
 */
export function detectOrigin(input: OriginInput): Origin {
  const { name, type, cameraMake, cameraModel, folderPath } = input
  if (WHATSAPP_NAME.test(name) || /whatsapp/i.test(folderPath ?? '')) return 'whatsapp'
  if (cameraMake || cameraModel) return 'camera'
  if (SCREENSHOT_NAME.test(name)) return 'unknown'
  if (CAMERA_NAMES.some((re) => re.test(name))) return 'camera'
  // A photo without any camera data and without a camera-like name was
  // most likely saved from a website or a browser.
  if (type === 'photo') return 'web'
  return 'unknown'
}

/** Bigger Drive thumbnail: Drive links end with "=s220"; ask for another size. */
export function sizedThumbnailLink(link: string, size: number): string {
  if (/=s\d+(-[a-z]+)?$/i.test(link)) return link.replace(/=s\d+(-[a-z]+)?$/i, `=s${size}`)
  return `${link}=s${size}`
}
