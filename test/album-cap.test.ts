import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/db/db', () => ({ db: () => ({}) }))
const { albumCap } = await import('../src/models/references')

describe('albumCap', () => {
  it('keeps every photo when they all fit', () => {
    expect(albumCap([346, 50, 20, 10], 5600)).toBe(346)
  })
  it('gives the room of the small albums to the big ones', () => {
    // 100 small albums of 10 (1,000) + 4 big ones: 4,600 left, 1,150 each.
    const cap = albumCap([...Array(100).fill(10), 3000, 3000, 3000, 3000], 5600)
    expect(cap).toBe(1150)
  })
  it('never more than the limit, never under 5 a album', () => {
    const sizes = Array(2000).fill(50)
    expect(albumCap(sizes, 5600)).toBe(5)
    const cap = albumCap(Array(122).fill(100), 5600)
    expect(cap * 122).toBeLessThanOrEqual(5600)
  })
})
