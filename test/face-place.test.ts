import { describe, expect, it } from 'vitest'
import { quantize } from '../src/lib/classifier'
import { placeFace, type KnownFace } from '../src/lib/faces'

const v = (...xs: number[]) => quantize(Float32Array.from(xs))
const unit = (cos: number) => v(cos, Math.sqrt(1 - cos * cos), 0)

describe('placing a new face', () => {
  const named = (p: string) => p === 'N'

  it('one alike face of a named person is not enough: the mean of its closest faces counts', () => {
    const known: KnownFace[] = [
      { id: 'n1', personId: 'N', emb: unit(0.6) },
      { id: 'n2', personId: 'N', emb: v(0, 0, 1) },
      { id: 'n3', personId: 'N', emb: v(0, 0, 1) },
    ]
    const r = placeFace(v(1, 0, 0), 0.2, known, named)
    expect(r.personId).toBeNull()
    expect(r.suggested).toBeUndefined()
  })

  it('a named person needs 0.5: between 0.32 and 0.5 it is only suggested', () => {
    const known: KnownFace[] = [{ id: 'n1', personId: 'N', emb: unit(0.45) }]
    expect(placeFace(v(1, 0, 0), 0.2, known, named)).toEqual({ personId: null, suggested: 'N' })
    expect(placeFace(v(1, 0, 0), 0.2, [{ id: 'n1', personId: 'N', emb: unit(0.6) }], named)).toEqual({ personId: 'N' })
  })

  it('a small face is never named on its own, only suggested; it may join an unnamed group', () => {
    const known: KnownFace[] = [
      { id: 'n1', personId: 'N', emb: unit(0.8) },
      { id: 'u1', personId: 'U', emb: unit(0.5) },
    ]
    expect(placeFace(v(1, 0, 0), 0.03, known, named)).toEqual({ personId: 'U', suggested: 'N' })
  })

  it('faces placed by the user count a bit more', () => {
    const auto: KnownFace[] = [{ id: 'n1', personId: 'N', emb: unit(0.48) }]
    expect(placeFace(v(1, 0, 0), 0.2, auto, named).personId).toBeNull()
    expect(placeFace(v(1, 0, 0), 0.2, [{ ...auto[0], manual: true }], named).personId).toBe('N')
  })
})
