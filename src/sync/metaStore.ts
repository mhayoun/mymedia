// Reads and writes mymedia.json in the root folder, merging with local edits.
// Local edits are kept in IndexedDB until they are saved, so nothing is lost
// if the connection drops or the app is closed.

import { db } from '../db/db'
import { createTextFile, downloadText, DriveError, findChildByName, getFile, updateTextFile } from '../drive/api'
import {
  emptyMetaFile,
  isSameMeta,
  mergeMetaFiles,
  META_FILE_NAME,
  parseMetaFile,
  type MediaMeta,
  type MetaFile,
} from '../lib/metadata'
import { app } from '../store'

const SAVE_DELAY_MS = 3000
let saveTimer: ReturnType<typeof setTimeout> | null = null
let chain: Promise<unknown> = Promise.resolve()

/** Runs tasks one after another so two saves never overlap. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

async function localFile(): Promise<MetaFile> {
  const items: Record<string, MediaMeta> = {}
  for (const m of await db().meta.toArray()) items[m.id] = m
  return { ...emptyMetaFile(), items }
}

async function findMetaFileId(rootId: string): Promise<string | null> {
  const known = await db().getKv<string>('metaFileId')
  if (known) {
    try {
      const f = await getFile(known, 'id,trashed,parents')
      if (!f.trashed && f.parents?.includes(rootId)) return known
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e
    }
  }
  const found = await findChildByName(rootId, META_FILE_NAME)
  await db().setKv('metaFileId', found?.id ?? null)
  return found?.id ?? null
}

/** Merges the remote mymedia.json into the local copy. Returns the merged file. */
async function pullAndMerge(rootId: string): Promise<{ merged: MetaFile; fileId: string | null; remoteChanged: boolean }> {
  const fileId = await findMetaFileId(rootId)
  const local = await localFile()
  if (!fileId) return { merged: local, fileId: null, remoteChanged: true }
  const text = await downloadText(fileId)
  let remote: MetaFile
  try {
    remote = parseMetaFile(text)
  } catch (e) {
    // Never overwrite a file we cannot read: the user must fix or remove it.
    app().set({ error: 'errors.metaUnreadable' })
    throw e
  }
  const merged = mergeMetaFiles(remote, local)
  const changed: MediaMeta[] = []
  for (const item of Object.values(merged.items)) {
    const mine = local.items[item.id]
    if (!mine || mine.updatedAt !== item.updatedAt || !isSameMeta(mine, item)) changed.push(item)
  }
  if (changed.length) await db().meta.bulkPut(changed)
  let remoteChanged = Object.keys(merged.items).length !== Object.keys(remote.items).length
  if (!remoteChanged) {
    for (const item of Object.values(merged.items)) {
      if (remote.items[item.id]?.updatedAt !== item.updatedAt) {
        remoteChanged = true
        break
      }
    }
  }
  return { merged, fileId, remoteChanged }
}

/** Downloads and merges the shared metadata (call at each sync). */
export function pullMeta(rootId: string): Promise<void> {
  return serial(async () => {
    const { remoteChanged } = await pullAndMerge(rootId)
    if (remoteChanged) await db().setKv('metaDirty', true)
  })
}

/** Saves now if there are unsaved changes. */
export function saveMeta(): Promise<void> {
  return serial(async () => {
    const rootId = app().rootId
    if (!rootId || !(await db().getKv<boolean>('metaDirty'))) return
    const { merged, fileId } = await pullAndMerge(rootId)
    const content = JSON.stringify({ ...merged, updatedAt: Date.now() })
    if (fileId) await updateTextFile(fileId, content)
    else {
      const created = await createTextFile(META_FILE_NAME, rootId, content)
      await db().setKv('metaFileId', created.id)
    }
    await db().setKv('metaDirty', false)
  })
}

export async function markMetaDirty(): Promise<void> {
  await db().setKv('metaDirty', true)
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveMeta().catch((e) => console.error('[MyMedia] save failed', e))
  }, SAVE_DELAY_MS)
}

/** Edits one item (description, origin…) and schedules the save. */
export async function updateMeta(id: string, patch: Partial<MediaMeta>): Promise<void> {
  const cur = await db().meta.get(id)
  if (!cur) return
  await db().meta.put({ ...cur, ...patch, updatedAt: Date.now() })
  await markMetaDirty()
}
