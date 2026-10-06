import { describe, expect, it } from 'vitest'
import { average, calibrate, cosine, evaluate, predict, quantize, type LabeledVec } from './classifier'
import { isAutomaticName, meaningfulName, nameKey } from './filename'

describe('file names', () => {
  it('ignores automatic names', () => {
    for (const n of [
      'IMG_1234.jpg', 'DSC01234.JPG', '20260105_143022.jpg', 'IMG-20260105-WA0001.jpg', 'VID-20260105-WA0002.mp4',
      'PXL_20260105_143022123.jpg', 'Screenshot_20260105-143022.png', 'WhatsApp Image 2026-01-05 at 14.30.22.jpeg',
      'IMG_1234 (1).jpg', 'FB_IMG_1700000000000.jpg', '1234.jpg', 'MVIMG_20260105_143022.jpg', 'DJI_0042.MP4',
      'a1b2c3d4e5f6a7b8c9d0.jpg', 'image.png', 'photo-2.jpg',
    ]) expect(isAutomaticName(n), n).toBe(true)
  })

  it('keeps meaningful names', () => {
    expect(meaningfulName('נחליאלי לבן.jpg')).toBe('נחליאלי לבן')
    expect(meaningfulName('mom_birthday.mp4')).toBe('mom birthday')
    expect(meaningfulName('נחליאלי לבן (2).jpg')).toBe('נחליאלי לבן')
    expect(meaningfulName('Copy of Pesach 2026.jpg')).toBe('Pesach 2026')
    expect(meaningfulName('IMG_1234.jpg')).toBeNull()
  })

  it('compares names loosely', () => {
    expect(nameKey('נַחְלִיאֵלִי  לבן')).toBe(nameKey('נחליאלי לבן'))
    expect(nameKey('Mésange_bleue')).toBe(nameKey('mesange bleue'))
  })
})

// Synthetic fingerprints: each album is a direction plus noise.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296 - 0.5
  }
}
function cluster(center: Float32Array, noise: number, r: () => number) {
  return quantize(center.map((x) => x + noise * r()))
}

describe('classifier', () => {
  const r = rng(42)
  const dim = 64
  const centers = Array.from({ length: 5 }, () => Float32Array.from({ length: dim }, () => r()))
  const labeled: LabeledVec[] = []
  centers.forEach((c, k) => {
    for (let i = 0; i < 8; i++) labeled.push({ id: `${k}-${i}`, label: `album${k}`, vec: cluster(c, 0.6, r) })
  })

  it('quantizes to unit vectors', () => {
    const v = quantize(Float32Array.from([3, 4]))
    expect(cosine(v, v)).toBeCloseTo(1, 2)
  })

  it('finds the right album with a confident, calibrated score', () => {
    const tau = calibrate(labeled)
    const [top, second] = predict(cluster(centers[2], 0.6, r), labeled, null, tau)
    expect(top.label).toBe('album2')
    expect(top.confidence).toBeGreaterThan(0.85)
    expect(second.confidence).toBeLessThan(0.15)
  })

  it('is less sure for a photo between two albums', () => {
    const tau = calibrate(labeled)
    const mix = quantize(Float32Array.from(centers[0], (x, i) => x + centers[1][i]))
    const [top, second] = predict(mix, labeled, null, tau)
    const [clean] = predict(cluster(centers[0], 0.6, r), labeled, null, tau)
    expect(new Set([top.label, second.label])).toEqual(new Set(['album0', 'album1']))
    expect(top.confidence).toBeLessThan(clean.confidence)
    expect(second.confidence).toBeGreaterThan(0.001)
  })

  it('respects the allowed albums', () => {
    const [top] = predict(cluster(centers[2], 0.6, r), labeled, new Set(['album0', 'album1']), 0.02)
    expect(['album0', 'album1']).toContain(top.label)
  })

  it('averages video frames', () => {
    const a = cluster(centers[3], 0.6, r)
    const b = cluster(centers[3], 0.6, r)
    expect(predict(average([a, b]), labeled, null, 0.02)[0].label).toBe('album3')
  })

  it('reports accuracy per album', () => {
    const stats = evaluate(labeled, calibrate(labeled))
    expect(stats).toHaveLength(5)
    for (const s of stats) expect(s.correct / s.tested).toBeGreaterThan(0.8)
  })
})
