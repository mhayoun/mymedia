// Takes back photos given to another account that never accepted them (a
// transfer stopped half-way, the other account blocked): the folders went over,
// but the photos still belong to this account and no longer show in its MyMedia.
// Each one goes back to the category / album mymedia.json still records for it,
// and the offer made to the other account is withdrawn.

import { db } from '../db/db'
import { DriveError, ensureFolderPath, getFile, listPermissions, moveFile, moveInto, removePermission } from '../drive/api'
import { FOLDER_MIME } from '../lib/media'
import type { MediaMeta } from '../lib/metadata'
import { ALBUM_SEPARATOR } from '../lib/tree'
import { app } from '../store'
import { holdAutoSync, syncNow } from '../sync/engine'

export interface Stranded {
  id: string
  name: string
  /** Folder names from the MyMedia root, e.g. ["ציפורים", "דוכיפת"]; [] for the root. */
  path: string[]
  /** Where it is now (the other account's folder). */
  parent?: string
  /** Ownership offers to withdraw; undefined when Drive did not list them. */
  offers?: string[]
}

type Progress = (done: number, total: number) => void

function pathOf(m: MediaMeta): string[] {
  if (!m.category) return []
  return [m.category, ...(m.album ? m.album.split(ALBUM_SEPARATOR) : [])]
}

/**
 * The photos mymedia.json knows that are not in this MyMedia any more, yet
 * still belong to this account and are not in the trash. Nothing is changed.
 */
export async function findStranded(onProgress: Progress): Promise<Stranded[]> {
  await syncNow()
  const d = db()
  const here = new Set(await d.media.toCollection().primaryKeys())
  const folders = new Set(await d.folders.toCollection().primaryKeys())
  // Tombstones too: a device with a blank copy may have marked them deleted.
  const metas = (await d.meta.toArray()).filter((m) => !here.has(m.id))
  const out: Stranded[] = []
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < metas.length) {
      const m = metas[next++]
      try {
        // Read once here, so taking back costs only the move and the withdrawal.
        const f = await getFile(m.id, 'id,name,mimeType,trashed,ownedByMe,parents,permissions(id,pendingOwner)')
        const inMyMedia = (f.parents ?? []).some((p) => folders.has(p))
        if (f.ownedByMe && !f.trashed && f.mimeType !== FOLDER_MIME && !inMyMedia) {
          out.push({
            id: f.id,
            name: f.name,
            path: pathOf(m),
            parent: f.parents?.[0],
            offers: f.permissions?.filter((p) => p.pendingOwner).map((p) => p.id),
          })
        }
      } catch (e) {
        // Deleted for good (404) or not readable: nothing to take back.
        if (!(e instanceof DriveError)) throw e
      }
      onProgress(++done, metas.length)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return out
}

/** The list grouped by folder, the biggest first. */
export function groupStranded(list: Stranded[]): { path: string[]; count: number }[] {
  const groups = new Map<string, { path: string[]; count: number }>()
  for (const s of list) {
    const k = s.path.join('\u0000')
    const g = groups.get(k)
    if (g) g.count++
    else groups.set(k, { path: s.path, count: 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/** Puts each photo back in its folder (created if needed) and withdraws the offers. Returns how many failed. */
export function reclaim(list: Stranded[], onProgress: Progress): Promise<{ failed: number; reason?: string }> {
  // No load from Drive in the middle: thousands of photos arriving at once would
  // start thumbnails and recognition while the moves run.
  return holdAutoSync(() => reclaimAll(list, onProgress))
}

async function reclaimAll(list: Stranded[], onProgress: Progress): Promise<{ failed: number; reason?: string }> {
  const rootId = app().rootId!
  const folderIds = new Map<string, Promise<string>>()
  const folderOf = (path: string[]) => {
    const k = path.join('\u0000')
    let p = folderIds.get(k)
    if (!p) folderIds.set(k, (p = ensureFolderPath(rootId, path)))
    return p
  }
  // Folders one by one first: two photos of a new album must not create it twice.
  for (const g of groupStranded(list)) await folderOf(g.path)

  let next = 0
  let done = 0
  let failed = 0
  let reason: string | undefined
  const worker = async () => {
    while (next < list.length) {
      const s = list[next++]
      try {
        const to = await folderOf(s.path)
        if (s.parent) {
          await moveFile(s.id, to, s.parent).catch((e) => {
            // Not allowed to take it out of that folder: moveInto knows the other ways.
            if (e instanceof DriveError && e.status === 403) return moveInto(s.id, to)
            throw e
          })
        } else await moveInto(s.id, to)
        const offers = s.offers ?? (await listPermissions(s.id)).filter((p) => p.pendingOwner).map((p) => p.id)
        for (const id of offers) await removePermission(s.id, id).catch((e) => {
          // Already withdrawn (an earlier try): nothing left to do.
          if (!(e instanceof DriveError && e.status === 404)) throw e
        })
      } catch (e) {
        console.error('[MyMedia] reclaim', s.id, e)
        failed++
        reason ??= (e as Error).message
      }
      onProgress(++done, list.length)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  await syncNow()
  return { failed, reason }
}
