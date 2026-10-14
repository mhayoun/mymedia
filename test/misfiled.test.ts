import { describe, expect, it } from 'vitest'
import { findMisfiled, quantize, type LabeledVec } from '../src/lib/classifier'

const vec = (...v: number[]) => quantize(Float32Array.from(v))
const ex = (id: string, label: string, ...v: number[]): LabeledVec => ({ id, label, vec: vec(...v) })

describe('findMisfiled', () => {
  const groups = new Map([['a', 'birds'], ['b', 'birds'], ['c', 'family']])
  it('finds a photo that looks like another album of its category', () => {
    const set = [ex('a1', 'a', 1, 0, 0), ex('a2', 'a', 0.9, 0.1, 0), ex('a3', 'a', 0, 1, 0), ex('b1', 'b', 0, 1, 0.1), ex('b2', 'b', 0.1, 0.9, 0)]
    const found = findMisfiled(set, groups)
    expect(found.map((m) => [m.id, m.other])).toEqual([['a3', 'b']])
  })
  it('never proposes an album of another category', () => {
    const set = [ex('a1', 'a', 1, 0, 0), ex('a2', 'a', 0, 0, 1), ex('c1', 'c', 0, 0, 1), ex('c2', 'c', 0, 0.1, 1)]
    expect(findMisfiled(set, groups)).toEqual([])
  })
})
