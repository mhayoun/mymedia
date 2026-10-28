import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { turnBox } from './faces'
import { exifDateTime, jpegDimensions, jpegExif, jpegOrientation, rotateJpeg, turnOrientation } from './jpeg'

const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)))

describe('lossless rotation', () => {
  it('turns orientations a quarter at a time, and back', () => {
    expect([1, 6, 3, 8].map((o) => turnOrientation(o, 1))).toEqual([6, 3, 8, 1])
    expect([2, 7, 4, 5].map((o) => turnOrientation(o, 1))).toEqual([7, 4, 5, 2])
    for (let o = 1; o <= 8; o++) expect(turnOrientation(turnOrientation(o, 1), -1)).toBe(o)
  })

  it('changes the orientation already there, nothing else', () => {
    const src = fx('q95.jpg')
    expect(jpegOrientation(src)).toBe(6)
    const out = rotateJpeg(src, 1)!
    expect(out.length).toBe(src.length)
    expect(jpegOrientation(out)).toBe(3)
    expect(jpegOrientation(rotateJpeg(out, -1)!)).toBe(6)
    expect([...rotateJpeg(out, -1)!]).toEqual([...src])
  })

  it('adds the orientation to an EXIF without it, keeping the date', () => {
    const src = fx('dated.jpg')
    expect(jpegOrientation(src)).toBe(1)
    const out = rotateJpeg(src, -1)!
    expect(jpegOrientation(out)).toBe(8)
    expect(exifDateTime(jpegExif(out)!)).toBe('2025-12-24T18:30:00')
    expect(jpegDimensions(out)).toEqual({ width: 60, height: 40 })
    if (process.env.ROTATE_OUT) writeFileSync(join(process.env.ROTATE_OUT, 'dated-left.jpg'), out)
  })

  it('adds an EXIF to a JPEG without one', () => {
    const out = rotateJpeg(fx('noexif.jpg'), 1)!
    expect(jpegOrientation(out)).toBe(6)
    expect(jpegOrientation(rotateJpeg(out, 1)!)).toBe(3)
    if (process.env.ROTATE_OUT) writeFileSync(join(process.env.ROTATE_OUT, 'noexif-right.jpg'), out)
  })

  it('leaves other files alone', () => {
    expect(rotateJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 1)).toBeNull()
  })

  it('turns face boxes with their photo', () => {
    // A face at the top left goes to the top right after a clockwise turn.
    expect(turnBox([0.1, 0.2, 0.3, 0.4], 1).map((v) => +v.toFixed(3))).toEqual([0.4, 0.1, 0.4, 0.3])
    expect(turnBox(turnBox([0.1, 0.2, 0.3, 0.4], 1), -1).map((v) => +v.toFixed(3))).toEqual([0.1, 0.2, 0.3, 0.4])
  })
})
