import { describe, expect, it } from 'vitest'
import { quantize } from '../src/lib/classifier'
import { sharpness } from '../src/lib/sharpness'
import { groupPairs, pairKey, similarPairs } from '../src/lib/similar'

function random(seed: number, dim: number): Float32Array {
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    v[i] = seed / 0x7fffffff - 0.5
  }
  return v
}

/** `base` moved a little: resemblance about 1 - amount² / 2. */
function near(base: Float32Array, seed: number, amount: number): Float32Array {
  const noise = random(seed, base.length)
  const nb = Math.hypot(...base)
  const nn = Math.hypot(...noise)
  return base.map((x, i) => x / nb + (noise[i] / nn) * amount)
}

describe('similar photos', () => {
  const dim = 1536
  const a = random(1, dim)
  const b = random(2, dim)
  const ids = ['a', 'a2', 'b', 'b2', 'c']
  const vecs = [a, near(a, 9, 0.1), b, near(b, 7, 0.45), random(3, dim)].map(quantize)

  it('finds the pairs that look alike, not the others', () => {
    const pairs = similarPairs(ids, vecs, 0.85)
    expect(pairs.map((p) => `${p.a}-${p.b}`).sort()).toEqual(['a-a2', 'b-b2'])
    const aa = pairs.find((p) => p.a === 'a')!
    expect(aa.score).toBeGreaterThan(0.98)
    expect(pairs.find((p) => p.a === 'b')!.score).toBeLessThan(0.95)
  })

  it('groups by threshold, without the pairs set aside', () => {
    const pairs = similarPairs(ids, vecs, 0.85)
    expect(groupPairs(pairs, 0.95, new Set()).map((g) => g.ids.sort())).toEqual([['a', 'a2']])
    expect(groupPairs(pairs, 0.85, new Set())).toHaveLength(2)
    expect(groupPairs(pairs, 0.85, new Set([pairKey('a2', 'a')]))).toHaveLength(1)
  })

  it('joins chains into one group', () => {
    const g = groupPairs(
      [
        { a: 'x', b: 'y', score: 0.97 },
        { a: 'y', b: 'z', score: 0.96 },
      ],
      0.95,
      new Set(),
    )
    expect(g).toHaveLength(1)
    expect(g[0].ids.sort()).toEqual(['x', 'y', 'z'])
    expect(g[0].score).toBe(0.97)
  })
})

describe('sharpness', () => {
  const w = 64
  const h = 64
  const edges = new Float32Array(w * h).map((_, i) => ((i % w) >> 2) % 2 ? 255 : 0)
  const blurred = new Float32Array(w * h).map((_, i) => ((i % w) / w) * 255)

  it('is high for sharp edges and low for a smooth picture', () => {
    expect(sharpness(edges, w, h)).toBeGreaterThan(1000)
    expect(sharpness(blurred, w, h)).toBeLessThan(1)
  })

  it('counts a sharp part on a blurred background as sharp', () => {
    const bird = blurred.slice()
    for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) bird[y * w + x] = (x + y) % 2 ? 255 : 0
    expect(sharpness(bird, w, h)).toBeGreaterThan(1000)
  })
})
