// Byte-level helpers for JPEG / HEIC files: EXIF copy and quality estimate.
// Pure functions (no DOM), tested with real files.

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"

function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8
}

interface Segment {
  marker: number
  /** Offset of the 0xFF marker byte. */
  start: number
  /** Offset of the payload (after the 2-byte length). */
  data: number
  /** Offset just after the segment. */
  end: number
}

/** Header segments of a JPEG, up to the image data. */
function segments(b: Uint8Array): Segment[] {
  const out: Segment[] = []
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break
    const marker = b[i + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) break // start of scan / end of image
    const len = (b[i + 2] << 8) | b[i + 3]
    out.push({ marker, start: i, data: i + 4, end: i + 2 + len })
    i += 2 + len
  }
  return out
}

/** The TIFF part of a JPEG's EXIF (APP1) segment, or null. */
export function jpegExif(b: Uint8Array): Uint8Array | null {
  if (!isJpeg(b)) return null
  for (const s of segments(b)) {
    if (s.marker === 0xe1 && EXIF_HEADER.every((v, k) => b[s.data + k] === v)) return b.slice(s.data + 6, s.end)
  }
  return null
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

function type4(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
}

/** Child boxes of an ISO-BMFF container in [start, end). */
function boxes(b: Uint8Array, start: number, end: number): { type: string; data: number; end: number }[] {
  const out = []
  let i = start
  while (i + 8 <= end) {
    let size = u32(b, i)
    const type = type4(b, i + 4)
    let header = 8
    if (size === 1) {
      size = u32(b, i + 12) // 64-bit size: files we handle are < 4 GB
      header = 16
    } else if (size === 0) size = end - i
    if (size < header || i + size > end) break
    out.push({ type, data: i + header, end: i + size })
    i += size
  }
  return out
}

/** The TIFF part of a HEIC/HEIF file's EXIF item, or null. */
export function heicExif(b: Uint8Array): Uint8Array | null {
  const meta = boxes(b, 0, b.length).find((x) => x.type === 'meta')
  if (!meta) return null
  const inner = boxes(b, meta.data + 4, meta.end) // meta is a full box (4 bytes version/flags)
  const iinf = inner.find((x) => x.type === 'iinf')
  const iloc = inner.find((x) => x.type === 'iloc')
  if (!iinf || !iloc) return null

  // Item id of type "Exif".
  const iinfVersion = b[iinf.data]
  const entriesStart = iinf.data + 4 + (iinfVersion === 0 ? 2 : 4)
  let exifId = -1
  for (const infe of boxes(b, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue
    const v = b[infe.data]
    if (v < 2) continue
    const id = v === 2 ? (b[infe.data + 4] << 8) | b[infe.data + 5] : u32(b, infe.data + 4)
    const typeAt = infe.data + 4 + (v === 2 ? 2 : 4) + 2
    if (type4(b, typeAt) === 'Exif') exifId = id
  }
  if (exifId < 0) return null

  // Location of that item.
  const v = b[iloc.data]
  let p = iloc.data + 4
  const offsetSize = b[p] >> 4
  const lengthSize = b[p] & 15
  const baseSize = b[p + 1] >> 4
  const indexSize = v === 1 || v === 2 ? b[p + 1] & 15 : 0
  p += 2
  const read = (n: number) => {
    let val = 0
    for (let k = 0; k < n; k++) val = val * 256 + b[p + k]
    p += n
    return val
  }
  const count = v < 2 ? read(2) : read(4)
  for (let k = 0; k < count; k++) {
    const id = v < 2 ? read(2) : read(4)
    if (v === 1 || v === 2) read(2) // construction method
    read(2) // data reference index
    const base = read(baseSize)
    const extents = read(2)
    let offset = 0
    let length = 0
    for (let e = 0; e < extents; e++) {
      if (indexSize) read(indexSize)
      const o = read(offsetSize)
      const l = read(lengthSize)
      if (e === 0) {
        offset = base + o
        length = l
      }
    }
    if (id === exifId) {
      if (offset + length > b.length || length < 8) return null
      // Exif item = 4-byte offset to the TIFF header, then the TIFF data.
      const tiffStart = offset + 4 + u32(b, offset)
      const tiff = b.slice(tiffStart, offset + length)
      return tiff.length >= 8 ? tiff : null
    }
  }
  return null
}

/**
 * Sets the EXIF orientation to 1 ("normal"): the new pixels are already
 * upright (the browser applied the rotation), so a viewer must not rotate again.
 */
export function resetOrientation(tiff: Uint8Array): Uint8Array {
  const t = tiff.slice()
  if (t.length < 8) return t
  const le = t[0] === 0x49 // "II" little endian, "MM" big endian
  const r16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1])
  const r32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : u32(t, o))
  const ifd = r32(4)
  if (ifd + 2 > t.length) return t
  const n = r16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > t.length) break
    if (r16(e) === 0x0112) {
      // SHORT value stored in the first 2 bytes of the value field.
      if (le) {
        t[e + 8] = 1
        t[e + 9] = 0
      } else {
        t[e + 8] = 0
        t[e + 9] = 1
      }
    }
  }
  return t
}

/** Puts EXIF (TIFF data) right after the start of a JPEG, replacing any APP0/APP1. */
export function insertExif(jpeg: Uint8Array, tiff: Uint8Array): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg
  const length = tiff.length + 6 + 2
  if (length > 0xffff) return jpeg // too large for one segment: keep the image without it
  const app1 = new Uint8Array(4 + 6 + tiff.length)
  app1.set([0xff, 0xe1, length >> 8, length & 0xff, ...EXIF_HEADER])
  app1.set(tiff, 10)
  // Drop the encoder's JFIF/EXIF segments: EXIF must come first.
  let rest = 2
  for (const s of segments(jpeg)) {
    if (s.marker === 0xe0 || s.marker === 0xe1) rest = s.end
    else break
  }
  const out = new Uint8Array(2 + app1.length + jpeg.length - rest)
  out.set([0xff, 0xd8])
  out.set(app1, 2)
  out.set(jpeg.subarray(rest), 2 + app1.length)
  return out
}

// Standard luminance quantization table (JPEG Annex K), sum of its 64 values.
const STD_LUMA_SUM = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87,
  80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92,
  95, 98, 112, 100, 103, 99,
].reduce((a, b) => a + b, 0)

/**
 * Estimated JPEG quality (1–100, libjpeg scale) from the luminance
 * quantization table, or null if not a JPEG. Needs only the file's first bytes.
 */
export function estimateJpegQuality(b: Uint8Array): number | null {
  if (!isJpeg(b)) return null
  for (const s of segments(b)) {
    if (s.marker !== 0xdb) continue
    let p = s.data
    while (p < s.end) {
      const precision = b[p] >> 4
      const id = b[p] & 15
      p++
      let sum = 0
      for (let k = 0; k < 64; k++) sum += precision ? (b[p + 2 * k] << 8) | b[p + 2 * k + 1] : b[p + k]
      p += precision ? 128 : 64
      if (id === 0) {
        const scale = (sum * 100) / STD_LUMA_SUM
        const q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale
        return Math.max(1, Math.min(100, Math.round(q)))
      }
    }
  }
  return null
}

/** Date the photo was taken (EXIF DateTimeOriginal, else DateTime) as "YYYY-MM-DDTHH:mm:ss", or null. */
export function exifDateTime(tiff: Uint8Array): string | null {
  if (tiff.length < 8) return null
  const le = tiff[0] === 0x49
  const r16 = (o: number) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1])
  const r32 = (o: number) =>
    le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0 : u32(tiff, o)
  const entries = (ifd: number) => {
    const out = new Map<number, number>() // tag → offset of its 12-byte entry
    if (ifd + 2 > tiff.length) return out
    const n = r16(ifd)
    for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= tiff.length; k++) out.set(r16(ifd + 2 + k * 12), ifd + 2 + k * 12)
    return out
  }
  const ascii = (entry: number) => {
    const count = r32(entry + 4)
    const at = count > 4 ? r32(entry + 8) : entry + 8
    if (at + count > tiff.length) return null
    return String.fromCharCode(...tiff.subarray(at, at + count)).replace(/\0+$/, '')
  }
  const ifd0 = entries(r32(4))
  const exifPtr = ifd0.get(0x8769)
  const exif = exifPtr !== undefined ? entries(r32(exifPtr + 8)) : new Map<number, number>()
  for (const entry of [exif.get(0x9003), exif.get(0x9004), ifd0.get(0x0132)]) {
    if (entry === undefined) continue
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(ascii(entry) ?? '')
    if (m && m[1] !== '0000') return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
  }
  return null
}

/** Pixel size of a JPEG from its frame header, or null. */
export function jpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (!isJpeg(b)) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    const len = (b[i + 2] << 8) | b[i + 3]
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
    if (marker === 0xda) return null
    i += 2 + len
  }
  return null
}
