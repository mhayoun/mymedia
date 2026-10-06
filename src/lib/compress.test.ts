import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPRESS, planCompression, type PlanInput } from './compressPlan'
import { estimateJpegQuality, heicExif, insertExif, jpegExif, resetOrientation } from './jpeg'

const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)))

describe('jpeg', () => {
  it('estimates quality from quantization tables', () => {
    expect(estimateJpegQuality(fx('q50.jpg'))).toBe(50)
    expect(estimateJpegQuality(fx('q75.jpg'))).toBe(75)
    expect(estimateJpegQuality(fx('q95.jpg'))).toBe(95)
    expect(estimateJpegQuality(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('reads, fixes and re-inserts EXIF', () => {
    const exif = jpegExif(fx('q95.jpg'))!
    expect(exif).not.toBeNull()
    expect(jpegExif(fx('noexif.jpg'))).toBeNull()
    const fixed = resetOrientation(exif)
    const out = insertExif(fx('noexif.jpg'), fixed)
    const back = jpegExif(out)!
    expect(Buffer.from(back).equals(Buffer.from(fixed))).toBe(true)
    expect(Buffer.from(back).includes(Buffer.from('Canon'))).toBe(true)
    // Orientation tag now 1: find tag 0x0112 (little or big endian) followed by type SHORT.
    const le = back[0] === 0x49
    const tag = le ? [0x12, 0x01, 0x03, 0x00] : [0x01, 0x12, 0x00, 0x03]
    const at = Buffer.from(back).indexOf(Buffer.from(tag))
    expect(le ? back[at + 8] : back[at + 9]).toBe(1)
    expect(estimateJpegQuality(out)).toBe(85) // image data untouched
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
  })

  it('extracts EXIF from a HEIF container', () => {
    const tiff = jpegExif(fx('q95.jpg'))!
    const box = (type: string, ...parts: Uint8Array[]) => {
      const body = Buffer.concat(parts)
      const head = Buffer.alloc(8)
      head.writeUInt32BE(8 + body.length)
      head.write(type, 4, 'ascii')
      return new Uint8Array(Buffer.concat([head, body]))
    }
    const full = (v: number) => new Uint8Array([v, 0, 0, 0])
    const infe = box('infe', full(2), new Uint8Array([0, 7, 0, 0]), Buffer.from('Exif\0'))
    const iinf = box('iinf', full(0), new Uint8Array([0, 1]), infe)
    const exifItem = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(tiff)])
    const ftyp = box('ftyp', Buffer.from('heic\0\0\0\0mif1heic'))
    // iloc v0: offset_size 4, length_size 4, base_offset_size 0; offset patched below.
    const iloc = (offset: number) => {
      const b = Buffer.alloc(2 + 2 + 2 + 2 + 2 + 4 + 4)
      b.writeUInt8(0x44, 0)
      b.writeUInt8(0x00, 1)
      b.writeUInt16BE(1, 2) // item count
      b.writeUInt16BE(7, 4) // item id
      b.writeUInt16BE(0, 6) // data reference index
      b.writeUInt16BE(1, 8) // extent count
      b.writeUInt32BE(offset, 10)
      b.writeUInt32BE(exifItem.length, 14)
      return box('iloc', full(0), b)
    }
    const meta = (offset: number) => box('meta', full(0), iinf, iloc(offset))
    const headerLen = ftyp.length + meta(0).length + 8
    const file = Buffer.concat([ftyp, meta(headerLen), box('mdat', exifItem)])
    expect(Buffer.from(heicExif(new Uint8Array(file))!).equals(Buffer.from(tiff))).toBe(true)
  })
})

describe('compression plan', () => {
  const photo: PlanInput = {
    name: 'IMG_20260105_120000.jpg', type: 'photo', mimeType: 'image/jpeg', size: 10_000_000,
    width: 4000, height: 3000, cameraMake: 'Samsung', createdTime: '2026-10-06T10:00:00Z', origin: 'camera', jpegQuality: 95,
  }
  const manual = { mode: 'manual' as const, videoSupported: true }
  const auto = { mode: 'auto' as const, videoSupported: true, since: '2026-10-01T00:00:00Z' }

  it('compresses a big camera photo and estimates the result', () => {
    const p = planCompression(photo, DEFAULT_COMPRESS, auto)
    expect(p.ok).toBe(true)
    if (p.ok) expect(p.estimate).toBeLessThan(3_000_000) // 3000×2250 at 85 %
  })

  it('skips what is already done or not worth it', () => {
    const reason = (i: Partial<PlanInput>, ctx = manual) => {
      const p = planCompression({ ...photo, ...i }, DEFAULT_COMPRESS, ctx)
      return p.ok ? 'ok' : p.reason
    }
    expect(reason({ appProperties: { mymedia_compressed: '1' } })).toBe('compressedByApp')
    expect(reason({ size: 300_000 })).toBe('tooSmall')
    expect(reason({ name: 'IMG-20260105-WA0001.jpg', origin: 'whatsapp' })).toBe('alreadyCompressed')
    expect(reason({ width: 2400, height: 1800, jpegQuality: 80, size: 1_500_000 })).toBe('alreadyCompressed')
    expect(reason({ width: 2048, height: 1536, cameraMake: undefined, jpegQuality: null, size: 1_200_000 })).toBe('alreadyCompressed')
    expect(reason({ width: 2400, height: 1800, jpegQuality: 95, size: 1_000_000 })).toBe('noGain')
    expect(reason({ mimeType: 'image/heic', name: 'IMG_1.HEIC' })).toBe('ok')
    expect(planCompression({ ...photo, mimeType: 'image/png', name: 'a.png' }, { ...DEFAULT_COMPRESS, convertToJpeg: false }, manual)).toEqual({ ok: false, reason: 'format' })
  })

  it('applies the automatic rules only in automatic mode', () => {
    const reason = (i: Partial<PlanInput>) => {
      const p = planCompression({ ...photo, ...i }, DEFAULT_COMPRESS, auto)
      return p.ok ? 'ok' : p.reason
    }
    expect(reason({ size: 2_000_000, width: 2000, height: 1500, jpegQuality: 95 })).toBe('notBig')
    expect(reason({ createdTime: '2025-01-01T00:00:00Z' })).toBe('old')
    expect(reason({ origin: 'unknown' })).toBe('ok')
    expect(planCompression({ ...photo, origin: 'web' }, { ...DEFAULT_COMPRESS, origins: { ...DEFAULT_COMPRESS.origins, web: false } }, auto)).toEqual({ ok: false, reason: 'origin' })
  })

  it('plans videos only where they can be encoded', () => {
    const video: PlanInput = { ...photo, name: 'VID_1.mp4', type: 'video', mimeType: 'video/mp4', size: 200_000_000, width: 3840, height: 2160, durationMs: 60_000 }
    expect(planCompression(video, DEFAULT_COMPRESS, { ...manual, videoSupported: false })).toEqual({ ok: false, reason: 'videoNotHere' })
    const p = planCompression(video, DEFAULT_COMPRESS, manual)
    expect(p.ok && p.estimate).toBeCloseTo(((5_000_000 + 128_000) * 60) / 8, -3)
    // Already a light 1080p video: 5.3 Mbit/s
    expect(planCompression({ ...video, width: 1920, height: 1080, size: 40_000_000 }, DEFAULT_COMPRESS, manual)).toEqual({ ok: false, reason: 'alreadyCompressed' })
  })
})
