// Gets back, from the versions Drive keeps of mymedia.json, what MyMedia knew
// about the photos still there (see lib/recover). Started by the user.

import { db } from '../db/db'
import { downloadRevisionText, listRevisions, type Revision } from '../drive/api'
import { parseMetaFile } from '../lib/metadata'
import { planRecovery, type Recovery } from '../lib/recover'
import { app } from '../store'
import { findMetaFileId, markMetaDirty, saveMeta } from './metaStore'

/** The earlier versions of mymedia.json, newest first (the current one left out). */
export async function metaVersions(): Promise<{ fileId: string; versions: Revision[] }> {
  const rootId = app().rootId
  const fileId = rootId ? await findMetaFileId(rootId) : null
  if (!fileId) return { fileId: '', versions: [] }
  return { fileId, versions: (await listRevisions(fileId)).slice(0, -1).reverse() }
}

export async function checkVersion(fileId: string, revisionId: string): Promise<Recovery> {
  const old = parseMetaFile(await downloadRevisionText(fileId, revisionId))
  return planRecovery(await db().meta.toArray(), old)
}

/** Writes what was found back (and saves it to Drive). Returns the photos updated. */
export async function applyRecovery(recovery: Recovery): Promise<number> {
  const d = db()
  const now = Date.now()
  let done = 0
  await d.transaction('rw', d.meta, async () => {
    for (const [id, patch] of recovery.patches) {
      const cur = await d.meta.get(id)
      if (!cur || cur.deleted) continue
      await d.meta.put({ ...cur, ...patch, updatedAt: now })
      done++
    }
  })
  await markMetaDirty()
  await saveMeta()
  return done
}
