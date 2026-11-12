// Recording date of an MP4 / MOV video, read from its "mvhd" header box.
// Only a few hundred bytes are read, wherever the header is in the file.

/** Reads bytes [start, end) of the file. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>

const MAC_EPOCH_OFFSET = 2082844800 // seconds between 1904-01-01 and 1970-01-01

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}

/** Creation time (UTC) stored in the video, or null if absent / not set. */
export async function mp4CreationTime(read: ReadRange, size: number): Promise<Date | null> {
  let pos = 0
  for (let guard = 0; pos + 8 <= size && guard < 1000; guard++) {
    const h = await read(pos, Math.min(size, pos + 16))
    let boxSize = u32(h, 0)
    const type = String.fromCharCode(h[4], h[5], h[6], h[7])
    let header = 8
    if (boxSize === 1) {
      boxSize = u32(h, 8) * 2 ** 32 + u32(h, 12)
      header = 16
    } else if (boxSize === 0) boxSize = size - pos
    if (boxSize < header) return null
    if (type === 'moov') {
      // mvhd is usually the first box inside moov, but not always (Canon puts a 64 KB "udta" before it).
      const end = Math.min(size, pos + boxSize)
      let p = pos + header
      for (let inner = 0; p + 8 <= end && inner < 100; inner++) {
        const m = await read(p, Math.min(end, p + 40))
        const childSize = u32(m, 0)
        if (String.fromCharCode(m[4], m[5], m[6], m[7]) === 'mvhd') {
          const version = m[8]
          const seconds = version === 1 ? u32(m, 12) * 2 ** 32 + u32(m, 16) : u32(m, 12)
          if (!seconds) return null
          const date = new Date((seconds - MAC_EPOCH_OFFSET) * 1000)
          return date.getUTCFullYear() >= 1990 && date.getTime() <= Date.now() + 86_400_000 ? date : null
        }
        if (childSize < 8) return null
        p += childSize
      }
      return null
    }
    pos += boxSize
  }
  return null
}

/**
 * Some cameras (Canon…) write the recording time in local time, where the format wants UTC: read as UTC
 * it is off by the time zone (2 h in Israel). When the file's own time (kept by the copy) is the header's
 * read as local time, and not the header's read as UTC, the header was local: the real time is returned.
 */
export function localHeaderFix(header: Date, fileTime: number | null | undefined): Date {
  if (!fileTime) return header
  const asLocal = header.getTime() + header.getTimezoneOffset() * 60_000
  const near = (t: number) => Math.abs(t - fileTime) <= 10 * 60_000
  return asLocal !== header.getTime() && near(asLocal) && !near(header.getTime()) ? new Date(asLocal) : header
}
