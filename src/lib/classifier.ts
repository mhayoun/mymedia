// Nearest-neighbour classifier on image fingerprints (embeddings).
// Pure functions: used by the ML worker and by unit tests.

/** Quantized unit vector: value × 127, so cosine ≈ dot / 127². */
export type Vec = Int8Array

export interface LabeledVec {
  id: string
  label: string
  vec: Vec
}

export interface Prediction {
  label: string
  /** Calibrated probability 0..1. */
  confidence: number
}

const SCALE = 127 * 127
/** Number of closest examples per album that make its score. */
const TOP_K = 3

export function quantize(v: Float32Array): Vec {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  const out = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round((v[i] / norm) * 127)))
  return out
}

export function cosine(a: Vec, b: Vec): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s / SCALE
}

/** Combines several fingerprints (e.g. 3 video frames) into one. */
export function average(vecs: Vec[]): Vec {
  const sum = new Float32Array(vecs[0].length)
  for (const v of vecs) for (let i = 0; i < v.length; i++) sum[i] += v[i]
  return quantize(sum)
}

/** Score of each album: mean similarity of its TOP_K closest examples. */
export function labelScores(
  query: Vec,
  labeled: LabeledVec[],
  allowed: ReadonlySet<string> | null,
  excludeId?: string,
): Map<string, number> {
  const best = new Map<string, number[]>()
  for (const e of labeled) {
    if (e.id === excludeId || (allowed && !allowed.has(e.label))) continue
    const s = cosine(query, e.vec)
    const list = best.get(e.label)
    if (!list) best.set(e.label, [s])
    else if (list.length < TOP_K) list.push(s)
    else {
      let minI = 0
      for (let i = 1; i < list.length; i++) if (list[i] < list[minI]) minI = i
      if (s > list[minI]) list[minI] = s
    }
  }
  const scores = new Map<string, number>()
  for (const [label, list] of best) scores.set(label, list.reduce((a, b) => a + b, 0) / list.length)
  return scores
}

/** Turns album scores into probabilities; tau controls how sharp they are. */
export function rank(scores: Map<string, number>, tau: number, top = 4): Prediction[] {
  if (scores.size === 0) return []
  const entries = [...scores.entries()]
  const max = Math.max(...entries.map(([, s]) => s))
  let total = 0
  const exps = entries.map(([label, s]) => {
    const e = Math.exp((s - max) / tau)
    total += e
    return { label, e }
  })
  return exps
    .map(({ label, e }) => ({ label, confidence: e / total }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, top)
}

export function predict(query: Vec, labeled: LabeledVec[], allowed: ReadonlySet<string> | null, tau: number, excludeId?: string) {
  return rank(labelScores(query, labeled, allowed, excludeId), tau)
}

/** Deterministic sample of indexes (same result for the same data). */
function sample(n: number, max: number): number[] {
  if (n <= max) return [...Array(n).keys()]
  const step = n / max
  return Array.from({ length: max }, (_, i) => Math.floor(i * step))
}

// Not sharper than 0.01: being over-confident would move photos to the wrong album.
const TAU_GRID = [0.01, 0.0125, 0.015, 0.02, 0.03, 0.05, 0.08]

/**
 * Leave-one-out: each sampled photo is classified against all the others.
 * Picks the tau whose confidences best match reality (lowest log-loss), so
 * that "85 %" means right about 85 % of the time on this user's photos.
 */
export function calibrate(labeled: LabeledVec[], maxQueries = 600): number {
  const counts = labelCounts(labeled)
  const queries = sample(labeled.length, maxQueries).filter((i) => (counts.get(labeled[i].label) ?? 0) >= 2)
  if (queries.length < 10) return 0.02
  const all = queries.map((i) => ({ truth: labeled[i].label, scores: labelScores(labeled[i].vec, labeled, null, labeled[i].id) }))
  let bestTau = 0.02
  let bestLoss = Infinity
  for (const tau of TAU_GRID) {
    let loss = 0
    for (const q of all) {
      const p = rank(q.scores, tau, q.scores.size).find((r) => r.label === q.truth)?.confidence ?? 0
      loss -= Math.log(Math.max(p, 1e-6))
    }
    if (loss < bestLoss) {
      bestLoss = loss
      bestTau = tau
    }
  }
  return bestTau
}

export interface LabelStats {
  label: string
  examples: number
  tested: number
  correct: number
  /** Album most often predicted instead of this one. */
  confusedWith?: string
  confusedCount: number
}

export function labelCounts(labeled: LabeledVec[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of labeled) counts.set(e.label, (counts.get(e.label) ?? 0) + 1)
  return counts
}

/** Accuracy per album, measured leave-one-out. */
export function evaluate(labeled: LabeledVec[], tau: number, maxQueries = 1500): LabelStats[] {
  const counts = labelCounts(labeled)
  const stats = new Map<string, LabelStats>()
  const confusion = new Map<string, Map<string, number>>()
  for (const [label, n] of counts) stats.set(label, { label, examples: n, tested: 0, correct: 0, confusedCount: 0 })
  for (const i of sample(labeled.length, maxQueries)) {
    const q = labeled[i]
    if ((counts.get(q.label) ?? 0) < 2) continue
    const [top] = predict(q.vec, labeled, null, tau, q.id)
    const s = stats.get(q.label)!
    s.tested++
    if (top?.label === q.label) s.correct++
    else if (top) {
      const m = confusion.get(q.label) ?? new Map<string, number>()
      m.set(top.label, (m.get(top.label) ?? 0) + 1)
      confusion.set(q.label, m)
    }
  }
  for (const [label, m] of confusion) {
    const [other, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    const s = stats.get(label)!
    s.confusedWith = other
    s.confusedCount = n
  }
  return [...stats.values()]
}
