// mymedia-faces.json in the root folder: people and face fingerprints,
// shared between the user's devices. Face crops (pictures) are never stored
// in it: each device makes them from Drive's thumbnails.

import { db, type FaceRecord, type PersonRecord } from '../db/db'
import { createTextFile, downloadText, findChildByName, updateTextFile } from '../drive/api'
import { app } from '../store'

const FILE_NAME = 'mymedia-faces.json'
const MODEL = 'yunet2023mar+sface2021dec'
const SAVE_DELAY_MS = 4000

interface FacesFile {
  format: 'mymedia-faces'
  version: 1
  model: string
  persons: PersonRecord[]
  scans: Record<string, string>
  faces: (Omit<FaceRecord, 'emb'> & { emb: string })[]
}

let chain: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

function toBase64(v: Int8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)))
}

function fromBase64(s: string): Int8Array {
  const bin = atob(s)
  const out = new Int8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24
  return out
}

async function readRemote(rootId: string): Promise<{ fileId: string | null; data: FacesFile | null }> {
  const f = await findChildByName(rootId, FILE_NAME)
  if (!f) return { fileId: null, data: null }
  try {
    const data = JSON.parse(await downloadText(f.id)) as FacesFile
    if (data.format !== 'mymedia-faces' || data.model !== MODEL) return { fileId: f.id, data: null }
    return { fileId: f.id, data }
  } catch {
    return { fileId: f.id, data: null }
  }
}

/** Merges the remote file into the local tables (newest change of each item wins). */
async function mergeIn(data: FacesFile): Promise<boolean> {
  const d = db()
  const media = new Map((await d.media.toArray()).map((m) => [m.id, m.md5 ?? m.modifiedTime]))
  let changed = false
  await d.transaction('rw', [d.persons, d.faces, d.faceScans], async () => {
    const persons = new Map((await d.persons.toArray()).map((p) => [p.id, p]))
    for (const p of data.persons) {
      const cur = persons.get(p.id)
      if (!cur || p.updatedAt > cur.updatedAt) {
        await d.persons.put(p)
        changed = true
      }
    }
    const faces = new Map((await d.faces.toArray()).map((f) => [f.id, f]))
    for (const f of data.faces) {
      if (media.get(f.mediaId) !== f.version) continue
      const cur = faces.get(f.id)
      if (!cur || f.updatedAt > cur.updatedAt) {
        await d.faces.put({ ...f, emb: fromBase64(f.emb) })
        changed = true
      }
    }
    for (const [id, version] of Object.entries(data.scans)) {
      if (media.get(id) === version && (await d.faceScans.get(id))?.version !== version) {
        await d.faceScans.put({ id, version })
        changed = true
      }
    }
  })
  return changed
}

/** Gets the people and faces found on the user's other devices. */
export function pullFaces(): Promise<boolean> {
  return serial(async () => {
    const rootId = app().rootId
    if (!rootId) return false
    const { data } = await readRemote(rootId)
    return data ? mergeIn(data) : false
  })
}

export function saveFaces(): Promise<void> {
  return serial(async () => {
    const rootId = app().rootId
    const d = db()
    if (!rootId || !(await d.getKv<boolean>('facesDirty'))) return
    const { fileId, data } = await readRemote(rootId)
    if (data) await mergeIn(data)
    const file: FacesFile = {
      format: 'mymedia-faces',
      version: 1,
      model: MODEL,
      persons: await d.persons.toArray(),
      scans: Object.fromEntries((await d.faceScans.toArray()).map((s) => [s.id, s.version])),
      faces: (await d.faces.toArray()).map((f) => ({ ...f, emb: toBase64(f.emb) })),
    }
    const text = JSON.stringify(file)
    if (fileId) await updateTextFile(fileId, text)
    else await createTextFile(FILE_NAME, rootId, text)
    await d.setKv('facesDirty', false)
  })
}

let timer: ReturnType<typeof setTimeout> | null = null
export async function markFacesDirty(): Promise<void> {
  await db().setKv('facesDirty', true)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    saveFaces().catch((e) => console.error('[MyMedia] faces save failed', e))
  }, SAVE_DELAY_MS)
}

/** Removes every face, person and the Drive file (after the user confirmed). */
export async function deleteAllFaceData(): Promise<void> {
  const rootId = app().rootId
  const d = db()
  await d.transaction('rw', [d.faces, d.faceCrops, d.faceScans, d.persons], async () => {
    await d.faces.clear()
    await d.faceCrops.clear()
    await d.faceScans.clear()
    await d.persons.clear()
  })
  await d.setKv('facesDirty', false)
  if (rootId) {
    const f = await findChildByName(rootId, FILE_NAME)
    if (f) {
      const { deleteFilePermanently } = await import('../drive/api')
      await deleteFilePermanently(f.id)
    }
  }
}
