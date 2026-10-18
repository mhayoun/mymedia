import { describe, expect, it } from 'vitest'
import { facesToFollow, type GroupedFace } from '../src/lib/faces'

// Unit vectors in 3D, scaled to int8: similarity = cosine.
const v = (x: number, y: number, z: number) => {
  const n = Math.hypot(x, y, z)
  return Int8Array.from([x, y, z].map((c) => Math.round((c / n) * 127)))
}
const face = (id: string, personId: string | null, emb: Int8Array, by: 'auto' | 'manual' = 'auto', rejected?: string[]): GroupedFace => ({ id, personId, emb, by, rejected })

describe('facesToFollow', () => {
  const hadas = v(1, 0, 0)
  const noa = v(0, 1, 0)
  it('names the look-alikes without a name, near copies included, one after the other', () => {
    const faces = [
      face('fixed', 'H', hadas, 'manual'),
      ...Array.from({ length: 50 }, (_, i) => face(`copy${i}`, 'U', v(1, 0.05, 0.01 * i))),
      face('u2', 'U2', v(1, 0.3, 0)),
      face('other', 'U', noa),
    ]
    const moved = facesToFollow(faces, 'H', new Set(['U', 'U2']))
    expect(moved.size).toBe(51)
    expect(moved.has('other')).toBe(false)
  })
  it('leaves named photos, faces taken out of this person and faces of nobody', () => {
    const faces = [
      face('fixed', 'H', hadas, 'manual'),
      face('named', 'N', v(1, 0.05, 0)),
      face('r', 'U', v(1, 0.1, 0), 'auto', ['H']),
      face('nobody', null, v(1, 0, 0)),
    ]
    expect(facesToFollow(faces, 'H', new Set(['U'])).size).toBe(0)
  })
  it('keeps a face closer to the faces staying in its group', () => {
    const faces = [face('fixed', 'H', hadas, 'manual'), face('c', 'U', v(0.6, 1, 0)), face('u1', 'U', noa)]
    expect(facesToFollow(faces, 'H', new Set(['U'])).size).toBe(0)
  })
})
