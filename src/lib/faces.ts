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
export const SAME_PERSON = 0.5

export interface KnownFace {
  id: string
  personId: string
  emb: Int8Array
  /** People this face was explicitly removed from. */
  rejected?: string[]
  /** Put in its person by the user (named, merged, moved): counts a bit more. */
  manual?: boolean
}

/** A face gets a name on its own only this alike (else "Is this X?"). */
export const NAME_SURE = 0.6
/** Faces narrower than this share of the photo are blurry: never named on their own. */
export const SMALL_FACE = 0.07
/** "Is this X?" from this likeness. */
export const MAYBE_SAME = 0.4
/** A person is judged on its closest faces, not one: a single wrong face does not pull others in. */
const TOP_FACES = 3
const MANUAL_BONUS = 0.03

/** Each person's likeness to a face: the mean of its closest faces (those the user placed count a bit more). */
export function personScores(emb: Int8Array, known: KnownFace[], rejected: string[] = []): Map<string, number> {
  const sims = new Map<string, number[]>()
  for (const k of known) {
    if (rejected.includes(k.personId)) continue
    const s = faceSimilarity(emb, k.emb) + (k.manual ? MANUAL_BONUS : 0)
    const list = sims.get(k.personId)
    if (list) list.push(s)
    else sims.set(k.personId, [s])
  }
  const scores = new Map<string, number>()
  for (const [personId, list] of sims) {
    const top = list.sort((a, b) => b - a).slice(0, TOP_FACES)
    scores.set(personId, top.reduce((n, x) => n + x, 0) / top.length)
  }
  return scores
}

/**
 * Best existing group for a new face, if alike enough and not rejected for
 * that face. Null = new group.
 */
export function bestGroup(emb: Int8Array, known: KnownFace[], rejected: string[] = [], threshold = SAME_PERSON): { personId: string; similarity: number } | null {
  let best: { personId: string; similarity: number } | null = null
  for (const [personId, similarity] of personScores(emb, known, rejected)) {
    if (similarity >= threshold && (!best || similarity > best.similarity)) best = { personId, similarity }
  }
  return best
}

/**
 * Where a new face goes. A named person needs NAME_SURE and a face big enough;
 * an unnamed group SAME_PERSON. A named person alike but not enough is only
 * suggested ("Is this X?"). personId null = a new group.
 */
export function placeFace(
  emb: Int8Array,
  width: number,
  known: KnownFace[],
  isNamed: (personId: string) => boolean,
): { personId: string | null; suggested?: string } {
  let best: { personId: string; s: number } | null = null
  let maybe: { personId: string; s: number } | null = null
  for (const [personId, s] of personScores(emb, known)) {
    const named = isNamed(personId)
    const sure = named ? s >= NAME_SURE && width >= SMALL_FACE : s >= SAME_PERSON
    if (sure && (!best || s > best.s)) best = { personId, s }
    if (named && s >= MAYBE_SAME && (!maybe || s > maybe.s)) maybe = { personId, s }
  }
  if (best && isNamed(best.personId)) return { personId: best.personId }
  return { personId: best?.personId ?? null, suggested: maybe?.personId }
}

export interface GroupedFace {
  id: string
  personId: string | null
  emb: Int8Array
  by: 'auto' | 'manual'
  rejected?: string[]
  /** Share of the photo's width (small faces are blurry). */
  width?: number
}

/** A face named before (by the user or a merge) changes person only when this alike. */
export const SURELY_SAME = 0.6

/** Mean of the `TOP_FACES` highest values. */
function topMean(values: number[]): number {
  const top = values.sort((a, b) => b - a).slice(0, TOP_FACES)
  return top.length ? top.reduce((n, x) => n + x, 0) / top.length : -1
}

/**
 * After the user put faces into `targetId`: the faces of the `from` groups
 * (the groups without a name) that look like this person follow them. They
 * are compared with the faces the user placed (not with every face of the
 * person: one wrong face would pull others in, one after the other), on the
 * mean of the closest ones. Small faces (blurry) never follow. A face the
 * user took out of this person never comes back. Returns face id → new person.
 */
export function facesToFollow(faces: GroupedFace[], targetId: string, from: ReadonlySet<string>, threshold = SAME_PERSON): Map<string, string> {
  const moved = new Map<string, string>()
  const target = faces.filter((f) => f.personId === targetId)
  const placed = target.filter((f) => f.by === 'manual')
  const anchors = placed.length ? placed : target
  if (!anchors.length) return moved
  const byGroup = new Map<string, GroupedFace[]>()
  for (const f of faces) if (f.personId) byGroup.set(f.personId, [...(byGroup.get(f.personId) ?? []), f])
  const toTarget = new Map<string, number>()
  for (const f of faces) {
    if (!f.personId || !from.has(f.personId)) continue
    toTarget.set(f.id, topMean(anchors.map((m) => faceSimilarity(f.emb, m.emb))))
  }
  const needed = (f: GroupedFace) => (f.by === 'auto' ? threshold : Math.max(threshold, SURELY_SAME))
  const alike = (f: GroupedFace) =>
    (toTarget.get(f.id) ?? -1) >= needed(f) && !f.rejected?.includes(targetId) && !(f.width !== undefined && f.width < SMALL_FACE)
  for (const c of faces) {
    if (!c.personId || !from.has(c.personId) || !alike(c)) continue
    // Compared with the faces of its group that do not look like the person.
    let toStaying = -1
    for (const o of byGroup.get(c.personId) ?? []) {
      if (o !== c && !alike(o)) toStaying = Math.max(toStaying, faceSimilarity(c.emb, o.emb))
    }
    if (toTarget.get(c.id)! > toStaying) moved.set(c.id, targetId)
  }
  return moved
}

/**
 * Faces named automatically that do not look like their person enough:
 * compared with the faces the user placed (else with the person's other
 * faces), on the mean of the closest ones. Small faces too. Faces the user
 * placed are never doubted. Returns their ids.
 */
export function doubtfulFaces(faces: GroupedFace[], threshold = NAME_SURE): string[] {
  const doubtful: string[] = []
  const byPerson = new Map<string, GroupedFace[]>()
  for (const f of faces) if (f.personId) byPerson.set(f.personId, [...(byPerson.get(f.personId) ?? []), f])
  for (const group of byPerson.values()) {
    const placed = group.filter((f) => f.by === 'manual')
    for (const f of group) {
      if (f.by === 'manual') continue
      if (f.width !== undefined && f.width < SMALL_FACE) {
        doubtful.push(f.id)
        continue
      }
      const anchors = placed.length ? placed : group.filter((o) => o !== f)
      if (!anchors.length) continue // alone: nothing to compare with
      if (topMean(anchors.map((a) => faceSimilarity(f.emb, a.emb))) < threshold) doubtful.push(f.id)
    }
  }
  return doubtful
}

/** A face box ([x, y, width, height], 0..1) after a quarter turn of its photo (1 = clockwise). */
export function turnBox([x, y, w, h]: [number, number, number, number], turns: 1 | -1): [number, number, number, number] {
  return turns === 1 ? [1 - y - h, x, h, w] : [y, 1 - x - w, h, w]
}
