import { describe, expect, it } from 'vitest'
import { localHeaderFix, mp4CreationTime } from './mp4'

const MAC_EPOCH_OFFSET = 2082844800

function box(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  out.set(body, 8)
  return out
}
function mvhd(date: Date): Uint8Array {
  const body = new Uint8Array(100)
  new DataView(body.buffer).setUint32(4, date.getTime() / 1000 + MAC_EPOCH_OFFSET)
  return box('mvhd', body)
}
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const reader = (file: Uint8Array) => async (a: number, b: number) => file.slice(a, b)

describe('mp4CreationTime', () => {
  const when = new Date(Date.UTC(2012, 11, 21, 10, 36, 9))
  it('reads mvhd when it is first in moov', async () => {
    const file = cat(box('ftyp', new Uint8Array(16)), box('moov', mvhd(when)), box('mdat', new Uint8Array(32)))
    expect(await mp4CreationTime(reader(file), file.length)).toEqual(when)
  })
  it('finds mvhd after another box (Canon: udta first)', async () => {
    const file = cat(box('ftyp', new Uint8Array(16)), box('moov', cat(box('udta', new Uint8Array(65588)), mvhd(when))), box('mdat', new Uint8Array(32)))
    expect(await mp4CreationTime(reader(file), file.length)).toEqual(when)
  })
  it('gives null without mvhd', async () => {
    const file = cat(box('ftyp', new Uint8Array(16)), box('moov', box('udta', new Uint8Array(20))))
    expect(await mp4CreationTime(reader(file), file.length)).toBe(null)
  })
})

describe('localHeaderFix', () => {
  // As written by a Canon camera in Israel: 10:36:09 local time, stored as if it were UTC.
  const header = new Date(Date.UTC(2012, 11, 21, 10, 36, 9))
  const offset = header.getTimezoneOffset() * 60_000
  it('takes a local header for what it is when the file time says so', () => {
    if (!offset) return // a UTC machine cannot tell them apart
    const fileTime = header.getTime() + offset
    expect(localHeaderFix(header, fileTime).getTime()).toBe(fileTime)
  })
  it('keeps a header in UTC (phones) and one without a file time', () => {
    expect(localHeaderFix(header, header.getTime() + 60_000)).toEqual(header)
    expect(localHeaderFix(header, null)).toEqual(header)
    expect(localHeaderFix(header, header.getTime() + 5 * 86_400_000)).toEqual(header)
  })
})
