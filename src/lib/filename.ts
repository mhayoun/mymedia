// File names: automatic camera/app names are ignored, meaningful names
// ("נחליאלי לבן.jpg", "mom_birthday.mp4") are used as description / album.

import { baseName } from './media'

const AUTO_PATTERNS: RegExp[] = [
  /^(IMG|VID|AUD|PTT|STK|DOC)-\d{8}-WA\d+/i, // WhatsApp
  /^WhatsApp (Image|Video) \d{4}-\d{2}-\d{2} at .+/i,
  /^(IMG|VID|MVIMG|PANO|BURST|MOV|DSC[FN]?|DSCN|DJI|GOPR?|GH\d|PXL|P\d{6,}|MVI|SAM|CIMG|DCIM|PICT|IMAG|VIDEO|PHOTO|IMAGE|PIC)[_-]?\d/i,
  /^(Screenshot|Screen ?Shot|Screen ?Recording|Capture d.?[ée]cran|צילום מסך)/i,
  /^(FB_IMG|received|signal|telegram|photo|image|video|unnamed|download|images?)[_-]?[\d_-]*$/i,
  /^(FB_IMG|received|signal|Snapchat|InShot|CapCut)[_-]/i,
  /^[\d\s_.:-]+$/, // only digits, dates, times
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^[0-9a-f_-]{16,}$/i, // hashes
  /^[A-Z0-9]{2,5}_?\d{3,}$/, // generic CAMERA_1234
]

/** Removes "(1)", " - Copy", "Copy of …", "_edited" and similar decorations. */
function strip(name: string): string {
  return baseName(name)
    .replace(/^(copy of|copie de)\s+/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[\s_-]*(copy|copie|edited|modifi[ée])$/i, '')
    .replace(/[\s_-]+\d{1,3}$/, '') // "nahliel 2" → "nahliel"
    .trim()
}

export function isAutomaticName(name: string): boolean {
  const s = strip(name)
  return s.length === 0 || AUTO_PATTERNS.some((re) => re.test(s))
}

/**
 * Human-readable text from a meaningful file name ("mom_birthday" → "mom birthday"),
 * or null if the name is automatic or has no real words.
 */
export function meaningfulName(name: string): string | null {
  if (isAutomaticName(name)) return null
  const text = strip(name)
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  return letters >= 2 ? text : null
}

/** Key used to compare a file name with an album name (case, spaces, punctuation, Hebrew points ignored). */
export function nameKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '') // Hebrew vowel points / cantillation
    .replace(/\p{M}/gu, '') // accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
