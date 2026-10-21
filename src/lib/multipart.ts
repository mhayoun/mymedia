// Reads the files of a multipart/form-data body by hand: used when the
// browser's own reader finds nothing in what the phone's Share menu sent.

export interface Part {
  name: string
  filename?: string
  type: string
  data: Uint8Array
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

export function boundaryOf(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  return m ? (m[1] ?? m[2]) : null
}

/** The parts of the body; [] when it is not multipart or has none. */
export function parseMultipart(body: Uint8Array, contentType: string): Part[] {
  const boundary = boundaryOf(contentType) ?? sniffBoundary(body)
  if (!boundary) return []
  const delim = enc.encode(`--${boundary}`)
  const sep = enc.encode('\r\n\r\n')
  const parts: Part[] = []
  let at = indexOf(body, delim, 0)
  while (at >= 0) {
    const start = at + delim.length
    // "--" after the boundary: the end.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break
    const next = indexOf(body, delim, start)
    if (next < 0) break
    const headEnd = indexOf(body, sep, start)
    if (headEnd < 0 || headEnd > next) {
      at = next
      continue
    }
    const head = dec.decode(body.subarray(start, headEnd))
    // The data ends before the CRLF that precedes the next boundary.
    const dataEnd = body[next - 2] === 0x0d && body[next - 1] === 0x0a ? next - 2 : next
    const name = /name="([^"]*)"/i.exec(head)?.[1] ?? ''
    const filename = /filename\*?=(?:UTF-8'')?"?([^";\r\n]*)"?/i.exec(head)?.[1]
    const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim() ?? ''
    parts.push({ name, filename: filename ? safeDecode(filename) : undefined, type, data: body.subarray(headEnd + sep.length, dataEnd) })
    at = next
  }
  return parts
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** A body that starts with "--something\r\n": its boundary (when the header has none). */
function sniffBoundary(body: Uint8Array): string | null {
  const m = /^--([^\r\n]+)\r\n/.exec(dec.decode(body.subarray(0, 200)))
  return m ? m[1] : null
}

/** The first bytes of a body as readable text (for a message saying what came). */
export function preview(body: Uint8Array, n = 160): string {
  return Array.from(body.subarray(0, n), (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : b === 0x0d || b === 0x0a ? '¶' : '·')).join('')
}
