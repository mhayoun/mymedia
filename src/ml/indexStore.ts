// Shares image fingerprints between devices through two files in the root
// folder: mymedia-index.json (list) + mymedia-index.bin (vectors).

import { db, type EmbeddingRecord } from '../db/db'
import { createBinaryFile, createTextFile, downloadBlob, downloadText, findChildByName, updateBinaryFile, updateTextFile } from '../drive/api'
import { app } from '../store'
import { EMBED_DIM, MODEL_ID } from './protocol'

const JSON_NAME = 'mymedia-index.json'
const BIN_NAME = 'mymedia-index.bin'

interface IndexHeader {
  format: 'mymedia-index'
  version: 1
  model: string
  dim: number
  /** [file id, file version] in the order of the vectors in the .bin file. */
  items: [string, string][]
}

let chain: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

/** Media id → the version a fingerprint must have to be current. */
export function mediaVersion(rec: { md5?: string; modifiedTime: string }): string {
  return rec.md5 ?? rec.modifiedTime
}

async function readRemote(rootId: string): Promise<{ jsonId?: string; binId?: string; entries: EmbeddingRecord[] }> {
  const [jsonFile, binFile] = await Promise.all([findChildByName(rootId, JSON_NAME), findChildByName(rootId, BIN_NAME)])
  if (!jsonFile || !binFile) return { jsonId: jsonFile?.id, binId: binFile?.id, entries: [] }
  try {
    const header = JSON.parse(await downloadText(jsonFile.id)) as IndexHeader
    if (header.format !== 'mymedia-index' || header.model !== MODEL_ID || header.dim !== EMBED_DIM) {
      return { jsonId: jsonFile.id, binId: binFile.id, entries: [] } // other model: rebuilt locally
    }
    const bytes = new Int8Array(await (await downloadBlob(binFile.id)).arrayBuffer())
    if (bytes.length !== header.items.length * header.dim) return { jsonId: jsonFile.id, binId: binFile.id, entries: [] }
    const entries = header.items.map(([id, version], i) => ({
      id,
      version,
      vec: bytes.slice(i * header.dim, (i + 1) * header.dim),
    }))
    return { jsonId: jsonFile.id, binId: binFile.id, entries }
  } catch (e) {
    console.warn('[MyMedia] index file unreadable, it will be rebuilt', e)
    return { jsonId: jsonFile.id, binId: binFile.id, entries: [] }
  }
}

/** Adds fingerprints computed on other devices to the local index. */
export function pullIndex(): Promise<number> {
  return serial(async () => {
    const rootId = app().rootId
    if (!rootId) return 0
    const { entries } = await readRemote(rootId)
    const d = db()
    const media = new Map((await d.media.toArray()).map((m) => [m.id, mediaVersion(m)]))
    const local = new Map((await d.embeddings.toArray()).map((e) => [e.id, e]))
    const add = entries.filter((e) => media.get(e.id) === e.version && local.get(e.id)?.version !== e.version)
    if (add.length) await d.embeddings.bulkPut(add)
    return add.length
  })
}

/** Writes the local index (merged with the remote one, unless `replace`) to Drive. */
export function saveIndex(replace = false): Promise<void> {
  return serial(async () => {
    const rootId = app().rootId
    const d = db()
    if (!rootId || !(await d.getKv<boolean>('indexDirty'))) return
    const remote = await readRemote(rootId)
    const media = new Map((await d.media.toArray()).map((m) => [m.id, mediaVersion(m)]))
    const merged = new Map<string, EmbeddingRecord>()
    for (const e of [...(replace ? [] : remote.entries), ...(await d.embeddings.toArray())]) {
      if (e.vec && media.get(e.id) === e.version) merged.set(e.id, e)
    }
    const list = [...merged.values()]
    const header: IndexHeader = {
      format: 'mymedia-index',
      version: 1,
      model: MODEL_ID,
      dim: EMBED_DIM,
      items: list.map((e) => [e.id, e.version]),
    }
    const bin = new Int8Array(list.length * EMBED_DIM)
    list.forEach((e, i) => bin.set(e.vec!, i * EMBED_DIM))
    const blob = new Blob([bin])
    // .bin first: a reader only trusts it when its size matches the .json list.
    if (remote.binId) await updateBinaryFile(remote.binId, blob)
    else await createBinaryFile(BIN_NAME, rootId, blob)
    const text = JSON.stringify(header)
    if (remote.jsonId) await updateTextFile(remote.jsonId, text)
    else await createTextFile(JSON_NAME, rootId, text)
    await d.setKv('indexDirty', false)
  })
}
