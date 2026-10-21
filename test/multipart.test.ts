import { describe, expect, it } from 'vitest'
import { parseMultipart } from '../src/lib/multipart'

const enc = new TextEncoder()
const body = (s: string) => enc.encode(s.replace(/\n/g, '\r\n'))

describe('parseMultipart', () => {
  it('reads the files of a share', () => {
    const b = body('--XYZ\nContent-Disposition: form-data; name="media"; filename="IMG-1.jpg"\nContent-Type: image/jpeg\n\nABC\n--XYZ\nContent-Disposition: form-data; name="media"; filename="V.mp4"\nContent-Type: video/mp4\n\nDE\n--XYZ--\n')
    const parts = parseMultipart(b, 'multipart/form-data; boundary=XYZ')
    expect(parts.map((p) => [p.name, p.filename, p.type, new TextDecoder().decode(p.data)])).toEqual([
      ['media', 'IMG-1.jpg', 'image/jpeg', 'ABC'],
      ['media', 'V.mp4', 'video/mp4', 'DE'],
    ])
  })
  it('finds the boundary in the body when the header has none', () => {
    const b = body('--Q1\nContent-Disposition: form-data; name="media"; filename="a.png"\nContent-Type: image/png\n\nX\n--Q1--\n')
    expect(parseMultipart(b, 'multipart/form-data')[0].filename).toBe('a.png')
  })
  it('nothing for an empty body', () => {
    expect(parseMultipart(new Uint8Array(), 'multipart/form-data; boundary=a')).toEqual([])
  })
})
