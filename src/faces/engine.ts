// Grouping faces into people, naming, merging, splitting, and keeping the
// "people" of each media in mymedia.json up to date.

import { db, type FaceRecord, type MediaRecord, type PersonRecord } from '../db/db'
import { bestGroup, faceSimilarity, SAME_PERSON, type KnownFace } from '../lib/faces'
import type { FoundFace } from '../ml/faceModel'
import { markMetaDirty } from '../sync/metaStore'
import { markFacesDirty } from './store'

/** Below SAME_PERSON but above this: "Is this X?" (asked to the user). */
const MAYBE_SAME = 0.32
/** Two faces found in different frames of one video are the same person above this. */
const SAME_IN_VIDEO = 0.55

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

async function knownFaces(): Promise<KnownFace[]> {
  const persons = new Map((await db().persons.toArray()).map((p) => [p.id, p]))
  return (await db().faces.toArray())
    .filter((f) => f.personId && !persons.get(f.personId)?.mergedInto)
    .map((f) => ({ id: f.id, personId: f.personId!, emb: f.emb, rejected: f.rejected }))
}

/** Video frames often show the same face several times: keep the best one per person. */
function dedupe(frames: FoundFace[][]): FoundFace[] {
  const kept: FoundFace[] = []
  for (const f of frames.flat().sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => faceSimilarity(k.emb, f.emb) >= SAME_IN_VIDEO)) kept.push(f)
  }
  return kept
}

/** Stores the faces found in a media and puts each one in a group. */
export async function addFaces(rec: MediaRecord, version: string, frames: FoundFace[][]): Promise<void> {
  const d = db()
  const found = dedupe(frames)
  const known = await knownFaces()
  const persons = new Map((await d.persons.toArray()).map((p) => [p.id, p]))
  const now = Date.now()
  const old = await d.faces.where('mediaId').equals(rec.id).primaryKeys()
  const faces: FaceRecord[] = []
  const crops: { id: string; blob: Blob }[] = []
  const newPersons: PersonRecord[] = []
  for (const [n, f] of found.entries()) {
    const id = `${rec.id}#${n}`
    const group = bestGroup(f.emb, known, [], SAME_PERSON)
    let personId: string
    let suggested: string | undefined
    if (group) personId = group.personId
    else {
      personId = newId()
      newPersons.push({ id: personId, updatedAt: now })
      const maybe = bestGroup(f.emb, known.filter((k) => persons.get(k.personId)?.name), [], MAYBE_SAME)
      suggested = maybe?.personId
    }
    const face: FaceRecord = { id, mediaId: rec.id, version, box: f.box, score: f.score, emb: f.emb, personId, by: 'auto', suggested, updatedAt: now }
    faces.push(face)
    crops.push({ id, blob: f.crop })
    known.push({ id, personId, emb: f.emb })
  }
  await d.transaction('rw', [d.faces, d.faceCrops, d.faceScans, d.persons], async () => {
    await d.faces.bulkDelete(old)
    await d.faceCrops.bulkDelete(old)
    await d.persons.bulkPut(newPersons)
    await d.faces.bulkPut(faces)
    await d.faceCrops.bulkPut(crops)
    await d.faceScans.put({ id: rec.id, version })
  })
  await updatePeople([rec.id])
  await markFacesDirty()
}

/** Recomputes the "people" (names) of these media in mymedia.json. */
export async function updatePeople(mediaIds: string[]): Promise<void> {
  const d = db()
  const persons = new Map((await d.persons.toArray()).map((p) => [p.id, p]))
  const resolve = (id: string | null): PersonRecord | undefined => {
    let p = id ? persons.get(id) : undefined
    for (let guard = 0; p?.mergedInto && guard < 20; guard++) p = persons.get(p.mergedInto)
    return p
  }
  let changed = false
  for (const mediaId of new Set(mediaIds)) {
    const names = [
      ...new Set(
        (await d.faces.where('mediaId').equals(mediaId).toArray())
          .map((f) => resolve(f.personId)?.name)
          .filter((n): n is string => !!n),
      ),
    ].sort()
    const meta = await d.meta.get(mediaId)
    if (meta && JSON.stringify(meta.people ?? []) !== JSON.stringify(names)) {
      await d.meta.put({ ...meta, people: names.length ? names : undefined, updatedAt: Date.now() })
      changed = true
    }
  }
  if (changed) await markMetaDirty()
}

async function mediaOfPersons(personIds: string[]): Promise<string[]> {
  return (await db().faces.where('personId').anyOf(personIds).toArray()).map((f) => f.mediaId)
}

/**
 * Names a group. If another group already has this name, both are merged:
 * they are the same person.
 */
export async function namePerson(personId: string, name: string): Promise<void> {
  const d = db()
  const clean = name.trim().replace(/\s+/g, ' ')
  const same = (await d.persons.toArray()).find(
    (p) => p.id !== personId && !p.mergedInto && p.name?.localeCompare(clean, undefined, { sensitivity: 'base' }) === 0,
  )
  if (same) return mergePersons(same.id, [personId])
  await d.persons.update(personId, { name: clean, updatedAt: Date.now() })
  // Faces that were "maybe this person" are now asked about by name.
  await updatePeople(await mediaOfPersons([personId]))
  await markFacesDirty()
}

/** Moves every face of `sources` into `target`. */
export async function mergePersons(targetId: string, sourceIds: string[]): Promise<void> {
  const d = db()
  const now = Date.now()
  const sources = sourceIds.filter((s) => s !== targetId)
  const target = await d.persons.get(targetId)
  const firstName = target?.name ?? (await d.persons.bulkGet(sources)).find((p) => p?.name)?.name
  const media = await mediaOfPersons(sources)
  await d.transaction('rw', [d.faces, d.persons], async () => {
    await d.faces.where('personId').anyOf(sources).modify({ personId: targetId, by: 'manual', updatedAt: now })
    for (const s of sources) await d.persons.update(s, { mergedInto: targetId, updatedAt: now })
    await d.persons.update(targetId, { name: firstName, updatedAt: now })
  })
  await updatePeople(media)
  await markFacesDirty()
}

/** These faces are another person: they form a new group. */
export async function splitFaces(faceIds: string[]): Promise<string> {
  const d = db()
  const now = Date.now()
  const id = newId()
  const faces = (await d.faces.bulkGet(faceIds)).filter((f): f is FaceRecord => !!f)
  await d.transaction('rw', [d.faces, d.persons], async () => {
    await d.persons.put({ id, updatedAt: now })
    for (const f of faces) {
      const rejected = f.personId ? [...new Set([...(f.rejected ?? []), f.personId])] : f.rejected
      await d.faces.put({ ...f, personId: id, by: 'manual', rejected, suggested: undefined, updatedAt: now })
    }
  })
  await updatePeople(faces.map((f) => f.mediaId))
  await markFacesDirty()
  return id
}

/** "Not this person": the faces leave their group (and won't be put back in it). */
export async function removeFaces(faceIds: string[]): Promise<void> {
  const d = db()
  const now = Date.now()
  const faces = (await d.faces.bulkGet(faceIds)).filter((f): f is FaceRecord => !!f)
  for (const f of faces) {
    const rejected = f.personId ? [...new Set([...(f.rejected ?? []), f.personId])] : f.rejected
    await d.faces.put({ ...f, personId: null, by: 'manual', rejected, suggested: undefined, updatedAt: now })
  }
  await updatePeople(faces.map((f) => f.mediaId))
  await markFacesDirty()
}

/** Puts faces into a person's group (confirmation of "Is this X?" or a manual choice). */
export async function assignFaces(faceIds: string[], personId: string): Promise<void> {
  const d = db()
  const now = Date.now()
  const faces = (await d.faces.bulkGet(faceIds)).filter((f): f is FaceRecord => !!f)
  for (const f of faces) {
    await d.faces.put({ ...f, personId, by: 'manual', suggested: undefined, rejected: f.rejected?.filter((r) => r !== personId), updatedAt: now })
  }
  await updatePeople(faces.map((f) => f.mediaId))
  await markFacesDirty()
}

/** "No, it's not X": the suggestion is dropped. */
export async function rejectSuggestion(faceId: string): Promise<void> {
  const d = db()
  const f = await d.faces.get(faceId)
  if (!f?.suggested) return
  await d.faces.put({ ...f, rejected: [...new Set([...(f.rejected ?? []), f.suggested])], suggested: undefined, updatedAt: Date.now() })
  await markFacesDirty()
}

/** The picture of a face; made again from Drive's thumbnail if this device has none. */
export async function faceCrop(face: FaceRecord): Promise<Blob | null> {
  const d = db()
  const hit = await d.faceCrops.get(face.id)
  if (hit) return hit.blob
  const rec = await d.media.get(face.mediaId)
  // Video faces come from frames this device does not have: no picture.
  if (!rec || rec.type === 'video') return null
  const { driveThumbnail } = await import('../sync/thumbs')
  const image = await driveThumbnail(rec, 1024)
  if (!image) return null
  const bitmap = await createImageBitmap(image)
  const [x, y, w, h] = face.box
  const side = Math.max(w * bitmap.width, h * bitmap.height) * 1.5
  const cx = (x + w / 2) * bitmap.width
  const cy = (y + h / 2) * bitmap.height
  const canvas = new OffscreenCanvas(128, 128)
  canvas.getContext('2d')!.drawImage(bitmap, cx - side / 2, cy - side / 2, side, side, 0, 0, 128, 128)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  await d.faceCrops.put({ id: face.id, blob })
  return blob
}

export { SAME_PERSON }
