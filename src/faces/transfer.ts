// People and faces that go with photos given to another account (see
// transfer/transfer.ts): the receiver keeps who is on each photo, and a name
// the receiver already uses joins the same person.

import { db, type FaceRecord, type PersonRecord } from '../db/db'
import { app } from '../store'
import { updatePeople } from './engine'
import { fromBase64, markFacesDirty, readRemote, toBase64, type FacesFile } from './store'

export interface TransferFaces {
  persons: PersonRecord[]
  faces: FacesFile['faces']
}

/** Persons of these faces, with the persons they were merged into. */
function personsOf(faces: { personId: string | null; suggested?: string; rejected?: string[] }[], all: Map<string, PersonRecord>): PersonRecord[] {
  const out = new Map<string, PersonRecord>()
  const add = (id: string | null | undefined) => {
    for (let p = id ? all.get(id) : undefined, guard = 0; p && !out.has(p.id) && guard < 20; guard++) {
      out.set(p.id, p)
      p = p.mergedInto ? all.get(p.mergedInto) : undefined
    }
  }
  for (const f of faces) {
    add(f.personId)
    add(f.suggested)
    for (const r of f.rejected ?? []) add(r)
  }
  return [...out.values()]
}

/** The faces of these media and their persons, as this account knows them. */
export async function facesOfMedia(mediaIds: Set<string>): Promise<TransferFaces> {
  const d = db()
  const faces = (await d.faces.where('mediaId').anyOf([...mediaIds]).toArray()).map((f) => ({ ...f, emb: toBase64(f.emb) }))
  const all = new Map((await d.persons.toArray()).map((p) => [p.id, p]))
  return { persons: personsOf(faces, all), faces }
}

/**
 * Faces of photos no longer in this MyMedia (given before people went with
 * the photos), from this device and from the account's faces file.
 */
export async function facesOfGivenMedia(): Promise<TransferFaces> {
  const d = db()
  const here = new Set(await d.media.toCollection().primaryKeys())
  const faces = new Map<string, FacesFile['faces'][number]>()
  const all = new Map((await d.persons.toArray()).map((p) => [p.id, p]))
  const rootId = app().rootId
  const remote = rootId ? (await readRemote(rootId).catch(() => null))?.data : null
  for (const p of remote?.persons ?? []) if (!all.has(p.id) || p.updatedAt > all.get(p.id)!.updatedAt) all.set(p.id, p)
  for (const f of remote?.faces ?? []) if (!here.has(f.mediaId)) faces.set(f.id, f)
  for (const f of await d.faces.toArray()) {
    if (here.has(f.mediaId)) continue
    const cur = faces.get(f.id)
    if (!cur || f.updatedAt >= cur.updatedAt) faces.set(f.id, { ...f, emb: toBase64(f.emb) })
  }
  const list = [...faces.values()]
  return { persons: personsOf(list, all), faces: list }
}

const sameName = (a?: string, b?: string) => !!a && !!b && a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0

/**
 * What to store from a transfer: the faces of photos here (same version),
 * the persons new here, and person ids moved to a person of the same name.
 */
export function planImport(data: TransferFaces, version: Map<string, string>, mine: PersonRecord[], now: number) {
  const map = new Map<string, string>()
  const persons: PersonRecord[] = []
  for (const p of data.persons) {
    const same = !p.mergedInto && mine.find((m) => !m.mergedInto && sameName(m.name, p.name))
    if (same) map.set(p.id, same.id)
    else if (!mine.some((m) => m.id === p.id)) persons.push(p)
  }
  const to = (id: string) => map.get(id) ?? id
  const faces = data.faces
    .filter((f) => version.get(f.mediaId) === f.version)
    .map(
      (f): FaceRecord => ({
        ...f,
        emb: fromBase64(f.emb),
        personId: f.personId && to(f.personId),
        suggested: f.suggested && to(f.suggested),
        rejected: f.rejected?.map(to),
        updatedAt: now,
      }),
    )
  return {
    faces,
    persons: persons.map((p) => ({ ...p, mergedInto: p.mergedInto && to(p.mergedInto), updatedAt: now })),
    mediaIds: [...new Set(faces.map((f) => f.mediaId))],
  }
}

/** Takes the faces of photos now in this MyMedia. Returns how many photos got them. */
export async function importFaces(data: TransferFaces): Promise<number> {
  const d = db()
  const version = new Map((await d.media.toArray()).map((m) => [m.id, m.md5 ?? m.modifiedTime]))
  const { faces, persons, mediaIds } = planImport(data, version, await d.persons.toArray(), Date.now())
  if (!faces.length) return 0
  await d.transaction('rw', [d.faces, d.faceCrops, d.faceScans, d.persons], async () => {
    // Faces this device may have found meanwhile are replaced by the sender's.
    const old = await d.faces.where('mediaId').anyOf(mediaIds).primaryKeys()
    await d.faces.bulkDelete(old)
    await d.faceCrops.bulkDelete(old)
    await d.persons.bulkPut(persons)
    await d.faces.bulkPut(faces)
    await d.faceScans.bulkPut(mediaIds.map((id) => ({ id, version: version.get(id)! })))
  })
  await updatePeople(mediaIds)
  await markFacesDirty()
  return mediaIds.length
}
