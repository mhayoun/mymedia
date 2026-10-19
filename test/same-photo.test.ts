import { describe, expect, it } from 'vitest'
import { predict, quantize, type LabeledVec } from '../src/lib/classifier'

const vec = (...xs: number[]) => quantize(Float32Array.from(xs))

describe('predict: the same photo among the examples', () => {
  // Album B's examples are closer on average, but A holds this very photo.
  const labeled: LabeledVec[] = [
    { id: 'a1', label: 'A', vec: vec(1, 0, 0, 0) },
    { id: 'a2', label: 'A', vec: vec(0, 0, 1, 0) },
    { id: 'a3', label: 'A', vec: vec(0, 0, 0, 1) },
    { id: 'b1', label: 'B', vec: vec(1, 0.6, 0, 0) },
    { id: 'b2', label: 'B', vec: vec(1, 0.7, 0, 0) },
    { id: 'b3', label: 'B', vec: vec(1, 0.8, 0, 0) },
  ]
  it('goes to the album of that photo, sure', () => {
    const [top, next] = predict(vec(1, 0.01, 0, 0), labeled, null, 0.02)
    expect(top).toMatchObject({ label: 'A', confidence: 1 })
    expect(top.closest).toBeGreaterThan(0.97)
    expect(next.confidence).toBe(0)
  })
  it('otherwise the albums are compared as before', () => {
    const [top] = predict(vec(1, 0.3, 0, 0.3), labeled, null, 0.02)
    expect(top.label).toBe('B')
    expect(top.confidence).toBeLessThan(1)
  })
})
