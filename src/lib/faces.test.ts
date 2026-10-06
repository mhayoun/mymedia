import { describe, expect, it } from 'vitest'
import { quantize } from './classifier'
import { alignmentMatrix, bestGroup, nms, SFACE_REFERENCE, type Detection } from './faces'

const det = (x: number, y: number, w: number, score: number): Detection => ({ x, y, w, h: w, score, kps: [] })

describe('faces', () => {
  it('keeps the best of overlapping detections', () => {
    const kept = nms([det(0, 0, 100, 0.8), det(5, 5, 100, 0.9), det(300, 300, 50, 0.7)])
    expect(kept.map((d) => d.score)).toEqual([0.9, 0.7])
  })

  it('aligns landmarks onto the reference points', () => {
    // Landmarks = reference scaled ×2, rotated 90°, shifted: the transform must undo it.
    const kps = SFACE_REFERENCE.flatMap(([x, y]) => [500 - 2 * y, 100 + 2 * x])
    const [a, b, c, d, e, f] = alignmentMatrix(kps)
    SFACE_REFERENCE.forEach(([rx, ry], i) => {
      const x = kps[2 * i]
      const y = kps[2 * i + 1]
      expect(a * x + c * y + e).toBeCloseTo(rx, 3)
      expect(b * x + d * y + f).toBeCloseTo(ry, 3)
    })
  })

  it('groups a face with the most similar person, or nobody', () => {
    const v = (...xs: number[]) => quantize(Float32Array.from(xs))
    const known = [
      { id: 'a1', personId: 'A', emb: v(1, 0, 0) },
      { id: 'b1', personId: 'B', emb: v(0, 1, 0) },
    ]
    expect(bestGroup(v(0.9, 0.2, 0), known)?.personId).toBe('A')
    expect(bestGroup(v(0, 0, 1), known)).toBeNull()
    expect(bestGroup(v(0.9, 0.2, 0), known, ['A'])).toBeNull()
  })
})
