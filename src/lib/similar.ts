// Photos that look alike (near-duplicates), from their fingerprints, and how
// to group them.

import type { Vec } from './classifier'

/** Two photos that look alike: resemblance 0..1 (1 = same file). */
export interface Pair {
  a: string
  b: string
  score: number
}

/** Lowest resemblance searched for (the slider goes from there to 99 %). */
export const MIN_SIMILAR = 0.85

const SCALE = 127 * 127
/** Size of the short fingerprints used to skip the pairs far apart. */
const SHORT = 128
/** Margin under the threshold for the short fingerprints (their error is about 0.03 near it). */
const MARGIN = 0.1

/** Same random ±1 projection on every device (fixed seed). */
function projection(dim: number): Int8Array {
  const r = new Int8Array(SHORT * dim)
  let seed = 0x2545f491
  for (let i = 0; i < r.length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    r[i] = seed & 1 ? 1 : -1
  }
  return r
}

/**
 * The pairs of fingerprints with a resemblance (cosine) of at least `min`.
 * Each fingerprint is first reduced to a short one to skip the pairs far
 * apart; the others are compared in full.
 */
export function similarPairs(ids: string[], vecs: Vec[], min = MIN_SIMILAR): Pair[] {
  const n = ids.length
  if (n < 2) return []
  const dim = vecs[0].length
  const r = projection(dim)
  const short = new Float32Array(n * SHORT)
  for (let i = 0; i < n; i++) {
    const v = vecs[i]
    let norm = 0
    for (let k = 0; k < SHORT; k++) {
      let s = 0
      const row = k * dim
      for (let j = 0; j < dim; j++) s += v[j] * r[row + j]
      short[i * SHORT + k] = s
      norm += s * s
    }
    norm = Math.sqrt(norm) || 1
    for (let k = 0; k < SHORT; k++) short[i * SHORT + k] /= norm
  }
  const near = min - MARGIN
  const out: Pair[] = []
  for (let i = 0; i < n; i++) {
    const oi = i * SHORT
    for (let j = i + 1; j < n; j++) {
      const oj = j * SHORT
      let s = 0
      for (let k = 0; k < SHORT; k++) s += short[oi + k] * short[oj + k]
      if (s < near) continue
      const a = vecs[i]
      const b = vecs[j]
      let d = 0
      for (let k = 0; k < dim; k++) d += a[k] * b[k]
      const score = Math.min(1, d / SCALE)
      if (score >= min) out.push({ a: ids[i], b: ids[j], score })
    }
  }
  return out
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/**
 * Groups of photos that look alike: pairs at `min` or more, without the pairs
 * the user said are not duplicates. Each group lists its photos and its
 * highest resemblance.
 */
export function groupPairs(pairs: Pair[], min: number, dismissed: ReadonlySet<string>): { ids: string[]; score: number }[] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let p = parent.get(x) ?? x
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p
    parent.set(x, p)
    return p
  }
  const best = new Map<string, number>()
  for (const { a, b, score } of pairs) {
    if (score < min || dismissed.has(pairKey(a, b))) continue
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
    // Recorded on the root once all are joined (below).
    best.set(a, Math.max(best.get(a) ?? 0, score))
    best.set(b, Math.max(best.get(b) ?? 0, score))
  }
  const groups = new Map<string, { ids: string[]; score: number }>()
  for (const id of best.keys()) {
    const root = find(id)
    const g = groups.get(root) ?? { ids: [], score: 0 }
    g.ids.push(id)
    g.score = Math.max(g.score, best.get(id)!)
    groups.set(root, g)
  }
  return [...groups.values()]
}
