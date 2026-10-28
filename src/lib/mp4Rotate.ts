// Turning an MP4 / MOV video without re-encoding it: players apply the
// matrix of the video track header (moov / trak / tkhd), so only those
// 36 bytes change. The file keeps its size; the rest is not read into memory.

/** Above this, the video is not turned (it is downloaded and uploaded whole). */
export const MAX_ROTATE_VIDEO = 1024 ** 3

interface Box {
  type: string
  /** Offset of the box header. */
  start: number
  /** Offset of the content (after the header). */
  body: number
  end: number
}

function readBox(v: DataView, at: number, limit: number): Box | null {
  if (at + 8 > limit) return null
  let size = v.getUint32(at)
  const type = String.fromCharCode(v.getUint8(at + 4), v.getUint8(at + 5), v.getUint8(at + 6), v.getUint8(at + 7))
  let body = at + 8
  if (size === 1) {
    if (at + 16 > limit) return null
    size = Number(v.getBigUint64(at + 8))
    body = at + 16
  } else if (size === 0) size = limit - at
  if (size < body - at || at + size > limit) return null
  return { type, start: at, body, end: at + size }
}

function children(v: DataView, parent: { body: number; end: number }): Box[] {
  const list: Box[] = []
  for (let at = parent.body; at < parent.end; ) {
    const b = readBox(v, at, parent.end)
    if (!b) break
    list.push(b)
    at = b.end
  }
  return list
}

/** The top-level moov box of the file, read from its header only. */
async function findMoov(file: Blob): Promise<{ start: number; end: number } | null> {
  for (let at = 0; at + 8 <= file.size; ) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer())
    const b = readBox(head, 0, Math.min(16, file.size - at))
    let size: number
    if (b) size = b.end - b.start
    else {
      // The header alone is in the 16 bytes; its size is checked against the file.
      size = head.getUint32(0)
      if (size === 1) size = Number(head.getBigUint64(8))
      else if (size === 0) size = file.size - at
    }
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7))
    if (size < 8 || at + size > file.size) return null
    if (type === 'moov') return { start: at, end: at + size }
    at += size
  }
  return null
}

/** The tkhd matrix offsets of the video tracks in a moov box. */
function videoMatrices(v: DataView): number[] {
  const moov = readBox(v, 0, v.byteLength)
  if (!moov || moov.type !== 'moov') return []
  const found: number[] = []
  for (const trak of children(v, moov).filter((b) => b.type === 'trak')) {
    const parts = children(v, trak)
    const tkhd = parts.find((b) => b.type === 'tkhd')
    const mdia = parts.find((b) => b.type === 'mdia')
    const hdlr = mdia && children(v, mdia).find((b) => b.type === 'hdlr')
    if (!tkhd || !hdlr || hdlr.body + 12 > hdlr.end) continue
    const handler = String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + hdlr.body + 8, 4))
    if (handler !== 'vide') continue
    const version = v.getUint8(tkhd.body)
    // version/flags, dates, track id, reserved, duration, reserved, layer, group, volume, reserved.
    const matrix = tkhd.body + 4 + (version === 1 ? 32 : 20) + 16
    if (matrix + 36 <= tkhd.end) found.push(matrix)
  }
  return found
}

const ONE = 0x10000
/** a, b, c, d of the matrix for 0°, 90°, 180°, 270° clockwise. */
const ROTATIONS = [
  [ONE, 0, 0, ONE],
  [0, ONE, -ONE, 0],
  [-ONE, 0, 0, -ONE],
  [0, -ONE, ONE, 0],
]

/** The rotation (quarter turns clockwise) a matrix describes, or null when it is something else (a mirror…). */
export function matrixTurns(v: DataView, at: number): number | null {
  const abcd = [v.getInt32(at), v.getInt32(at + 4), v.getInt32(at + 12), v.getInt32(at + 16)]
  const i = ROTATIONS.findIndex((r) => r.every((x, k) => x === abcd[k]))
  return i < 0 ? null : i
}

function writeMatrix(v: DataView, at: number, turns: number) {
  const [a, b, c, d] = ROTATIONS[turns]
  const values = [a, b, 0, c, d, 0, 0, 0, 0x40000000]
  values.forEach((x, k) => v.setInt32(at + k * 4, x))
}

/**
 * The video turned by a quarter turn (1: clockwise, -1: the other way), or
 * null when it cannot be (not MP4 / MOV, no video track, unusual matrix).
 */
export async function rotateMp4(file: Blob, turns: 1 | -1): Promise<Blob | null> {
  const moov = await findMoov(file)
  if (!moov) return null
  const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer())
  const v = new DataView(bytes.buffer)
  const matrices = videoMatrices(v)
  if (!matrices.length) return null
  const now = matrices.map((at) => matrixTurns(v, at))
  if (now.some((n) => n === null)) return null
  matrices.forEach((at, k) => writeMatrix(v, at, (now[k]! + turns + 4) % 4))
  return new Blob([file.slice(0, moov.start), bytes, file.slice(moov.end)], { type: file.type })
}

/** The rotation of the first video track, in quarter turns clockwise (tests, info). */
export async function mp4Turns(file: Blob): Promise<number | null> {
  const moov = await findMoov(file)
  if (!moov) return null
  const v = new DataView(await file.slice(moov.start, moov.end).arrayBuffer())
  const [at] = videoMatrices(v)
  return at === undefined ? null : matrixTurns(v, at)
}
