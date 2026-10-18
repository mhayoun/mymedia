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
  it('moves the faces of the wrong group that look like the fixed one, one after the other', () => {
    const faces = [
      face('fixed', 'H', hadas, 'manual'),
      face('h1', 'N', v(1, 0.2, 0)),
      face('h2', 'N', v(1, 0.5, 0)),
      face('n1', 'N', noa, 'manual'),
      face('n2', 'N', v(0.1, 1, 0)),
    ]
    const moved = facesToFollow(faces, 'H')
    expect([...moved.keys()].sort()).toEqual(['h1', 'h2'])
  })
  it('also fixes near copies under another name, even named by the user, but not faces taken out of this person', () => {
    const faces = [
      face('fixed', 'H', hadas, 'manual'),
      ...Array.from({ length: 50 }, (_, i) => face(`copy${i}`, 'N', v(1, 0.05, 0.01 * i), 'manual')),
      face('n1', 'N', noa, 'manual'),
      face('r', 'N', v(1, 0.1, 0), 'auto', ['H']),
      face('x', 'X', v(1, 0.1, 0)),
      face('nobody', null, v(1, 0, 0)),
    ]
    const moved = facesToFollow(faces, 'H')
    expect(moved.size).toBe(51)
    expect(moved.has('r') || moved.has('n1') || moved.has('nobody')).toBe(false)
  })
  it('a named face changes person only when clearly alike', () => {
    const faces = [face('fixed', 'H', hadas, 'manual'), face('m', 'N', v(1, 1.9, 0), 'manual'), face('a', 'M', v(1, -1.9, 0))]
    expect([...facesToFollow(faces, 'H').keys()]).toEqual(['a'])
  })
  it('keeps a face closer to its own group', () => {
    const faces = [face('fixed', 'H', hadas, 'manual'), face('c', 'N', v(0.6, 1, 0)), face('n1', 'N', noa, 'manual')]
    expect(facesToFollow(faces, 'H').size).toBe(0)
  })
})
