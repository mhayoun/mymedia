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
      // mvhd is normally the first box inside moov.
      const m = await read(pos + header, Math.min(size, pos + header + 40))
      if (String.fromCharCode(m[4], m[5], m[6], m[7]) !== 'mvhd') return null
      const version = m[8]
      const seconds = version === 1 ? u32(m, 12) * 2 ** 32 + u32(m, 16) : u32(m, 12)
      if (!seconds) return null
      const date = new Date((seconds - MAC_EPOCH_OFFSET) * 1000)
      return date.getUTCFullYear() >= 1990 && date.getTime() <= Date.now() + 86_400_000 ? date : null
    }
    pos += boxSize
  }
  return null
}
