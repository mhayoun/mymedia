import { describe, expect, it } from 'vitest'
import { mp4Turns, rotateMp4 } from '../src/lib/mp4Rotate'

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(size)
  new DataView(out.buffer).setUint32(0, size)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  let at = 8
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** tkhd version 0 with the identity matrix, 64×48. */
function tkhd(): Uint8Array {
  const b = new Uint8Array(84)
  const v = new DataView(b.buffer)
  ;[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].forEach((x, k) => v.setInt32(40 + k * 4, x))
  v.setUint32(76, 64 << 16)
  v.setUint32(80, 48 << 16)
  return b
}

function hdlr(handler: string): Uint8Array {
  const b = new Uint8Array(24)
  b.set([...handler].map((c) => c.charCodeAt(0)), 8)
  return b
}

const trak = (handler: string) => box('trak', box('tkhd', tkhd()), box('mdia', box('hdlr', hdlr(handler))))
const mdat = box('mdat', new Uint8Array(100).fill(7))
const ftyp = box('ftyp', new TextEncoder().encode('isom\0\0\0\0'))

describe('turning a video', () => {
  it('turns the video track, whether moov is before or after the data', async () => {
    for (const parts of [
      [ftyp, box('moov', trak('soun'), trak('vide')), mdat],
      [ftyp, mdat, box('moov', trak('vide'), trak('soun'))],
    ]) {
      const file = new Blob(parts as BlobPart[])
      expect(await mp4Turns(file)).toBe(0)
      const right = (await rotateMp4(file, 1))!
      expect(right.size).toBe(file.size)
      expect(await mp4Turns(right)).toBe(1)
      expect(await mp4Turns((await rotateMp4(right, 1))!)).toBe(2)
      expect(await mp4Turns((await rotateMp4(file, -1))!)).toBe(3)
      expect(await mp4Turns((await rotateMp4(right, -1))!)).toBe(0)
    }
  })

  it('refuses a file without a video track, or that is not MP4', async () => {
    expect(await rotateMp4(new Blob([ftyp, box('moov', trak('soun')), mdat] as BlobPart[]), 1)).toBeNull()
    expect(await rotateMp4(new Blob([new TextEncoder().encode('RIFF....AVI LIST')]), 1)).toBeNull()
  })
})
