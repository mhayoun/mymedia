// Face maths (pure, tested): YuNet output decoding, overlap removal,
// alignment transform for SFace, and grouping by similarity.

export interface Detection {
  x: number
  y: number
  w: number
  h: number
  score: number
  /** 5 landmarks: right eye, left eye, nose tip, right / left mouth corner (x,y pairs). */
  kps: number[]
}

const STRIDES = [8, 16, 32]

/** Decodes YuNet (2023mar) outputs for a square input of `size` pixels. */
export function decodeYunet(out: Record<string, Float32Array>, size: number, minScore: number): Detection[] {
  const dets: Detection[] = []
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`]
    const obj = out[`obj_${s}`]
    const bbox = out[`bbox_${s}`]
    const kps = out[`kps_${s}`]
    const cols = size / s
    const rows = size / s
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])))
        if (score < minScore) continue
        const cx = (c + bbox[i * 4]) * s
        const cy = (r + bbox[i * 4 + 1]) * s
        const w = Math.exp(bbox[i * 4 + 2]) * s
        const h = Math.exp(bbox[i * 4 + 3]) * s
        const points: number[] = []
        for (let n = 0; n < 5; n++) points.push((kps[i * 10 + 2 * n] + c) * s, (kps[i * 10 + 2 * n + 1] + r) * s)
        dets.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, kps: points })
      }
    }
  }
  return dets
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

/** Keeps the best detection among overlapping ones. */
export function nms(dets: Detection[], maxOverlap = 0.3): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score)
  const kept: Detection[] = []
  for (const d of sorted) if (kept.every((k) => iou(k, d) <= maxOverlap)) kept.push(d)
  return kept
}

/** Where SFace expects the 5 landmarks in its 112×112 input. */
export const SFACE_REFERENCE = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

/**
 * Least-squares similarity transform (rotation + uniform scale + shift)
 * mapping the landmarks onto the reference points. Returned as a canvas
 * matrix [a, b, c, d, e, f] for ctx.setTransform.
 */
export function alignmentMatrix(kps: number[], ref = SFACE_REFERENCE): [number, number, number, number, number, number] {
  const n = ref.length
  let sx = 0, sy = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    sx += kps[2 * i]
    sy += kps[2 * i + 1]
    dx += ref[i][0]
    dy += ref[i][1]
  }
  sx /= n; sy /= n; dx /= n; dy /= n
  let num1 = 0, num2 = 0, den = 0
  for (let i = 0; i < n; i++) {
    const px = kps[2 * i] - sx
    const py = kps[2 * i + 1] - sy
    const qx = ref[i][0] - dx
    const qy = ref[i][1] - dy
    num1 += px * qx + py * qy
    num2 += px * qy - py * qx
    den += px * px + py * py
  }
  const a = num1 / (den || 1)
  const b = num2 / (den || 1)
  const tx = dx - (a * sx - b * sy)
  const ty = dy - (b * sx + a * sy)
  return [a, b, -b, a, tx, ty]
}

/** Face fingerprints are quantized unit vectors (×127): cosine = dot / 127². */
export function faceSimilarity(a: Int8Array, b: Int8Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s / (127 * 127)
}

/**
 * SFace: two faces of the same person usually have a cosine similarity
 * above 0.363 (OpenCV's threshold). MyMedia is a bit stricter before
 * grouping automatically, to avoid mixing people.
 */
export const SAME_PERSON = 0.42

export interface KnownFace {
  id: string
  personId: string
  emb: Int8Array
  /** People this face was explicitly removed from. */
  rejected?: string[]
}

/**
 * Best existing group for a new face: the group of its most similar face,
 * if similar enough and not rejected for that face. Null = new group.
 */
export function bestGroup(emb: Int8Array, known: KnownFace[], rejected: string[] = [], threshold = SAME_PERSON): { personId: string; similarity: number } | null {
  const bestByPerson = new Map<string, number>()
  for (const k of known) {
    if (rejected.includes(k.personId)) continue
    const s = faceSimilarity(emb, k.emb)
    if (s > (bestByPerson.get(k.personId) ?? -1)) bestByPerson.set(k.personId, s)
  }
  let best: { personId: string; similarity: number } | null = null
  for (const [personId, similarity] of bestByPerson) {
    if (similarity >= threshold && (!best || similarity > best.similarity)) best = { personId, similarity }
  }
  return best
}
