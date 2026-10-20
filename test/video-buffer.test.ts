import { describe, expect, it } from 'vitest'
import { bytesBeforePlay } from '../src/lib/videoBuffer'

describe('playing a video on a slow connection', () => {
  it('fast enough: plays at once', () => {
    expect(bytesBeforePlay(10e6, 2e6, 60)).toBe(0)
  })
  it('slower than the video: waits for what the rest cannot catch up', () => {
    // 60 MB, 60 s (1 MB/s), 0.5 MB/s: 60 - 0.85 × 0.5 × 60 = 34.5 MB first.
    expect(bytesBeforePlay(60e6, 0.5e6, 60)).toBeCloseTo(34.5e6)
  })
  it('speed or duration unknown: the whole video', () => {
    expect(bytesBeforePlay(60e6, 0, 60)).toBe(60e6)
    expect(bytesBeforePlay(60e6, 1e6, NaN)).toBe(60e6)
  })
})
