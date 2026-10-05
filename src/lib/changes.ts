// Turns a batch of Drive Changes into operations on the local folder tree.
// Pure: no Drive or database access, so it can be unit-tested.

import { FOLDER_MIME, mediaTypeOf } from './media'

export interface ChangedFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  trashed?: boolean
}

export interface DriveChange {
  fileId: string
  removed?: boolean
  file?: ChangedFile
}

export interface ChangePlan {
  /** Folders inside the root to insert or update. */
  upsertFolders: ChangedFile[]
  /** Folders that newly entered the tree: their existing content must be scanned. */
  scanFolders: string[]
  /** Folders to remove together with everything below them. */
  removeFolders: string[]
  upsertMedia: ChangedFile[]
  removeMedia: string[]
  rootRemoved: boolean
}

/**
 * @param knownFolders ids of folders currently in the tree (the root included)
 * @param knownMedia ids of media currently indexed
 */
export function planChanges(
  changes: DriveChange[],
  rootId: string,
  knownFolders: ReadonlySet<string>,
  knownMedia: ReadonlySet<string>,
): ChangePlan {
  const plan: ChangePlan = {
    upsertFolders: [],
    scanFolders: [],
    removeFolders: [],
    upsertMedia: [],
    removeMedia: [],
    rootRemoved: false,
  }

  // Keep only the latest change per file.
  const latest = new Map<string, DriveChange>()
  for (const c of changes) latest.set(c.fileId, c)

  const folders = new Set(knownFolders)
  const folderChanges: DriveChange[] = []
  const otherChanges: DriveChange[] = []
  for (const c of latest.values()) {
    if (c.file?.mimeType === FOLDER_MIME || (c.removed && folders.has(c.fileId))) folderChanges.push(c)
    else otherChanges.push(c)
  }

  const gone = (c: DriveChange) => c.removed || !c.file || c.file.trashed

  // Folders first, repeated until stable, because a new folder and its new
  // sub-folders can arrive in any order.
  let pending = folderChanges
  let progress = true
  while (progress) {
    progress = false
    const next: DriveChange[] = []
    for (const c of pending) {
      if (c.fileId === rootId) {
        if (gone(c)) plan.rootRemoved = true
        progress = true
        continue
      }
      if (gone(c)) {
        if (folders.has(c.fileId)) {
          folders.delete(c.fileId)
          plan.removeFolders.push(c.fileId)
        }
        progress = true
      } else if ((c.file!.parents ?? []).some((p) => folders.has(p))) {
        if (!folders.has(c.fileId)) {
          folders.add(c.fileId)
          plan.scanFolders.push(c.fileId)
        }
        plan.upsertFolders.push(c.file!)
        progress = true
      } else {
        // Its parent may still be added later in this batch.
        next.push(c)
      }
    }
    pending = next
  }
  // What is left was moved outside the tree.
  for (const c of pending) {
    if (folders.has(c.fileId)) {
      folders.delete(c.fileId)
      plan.removeFolders.push(c.fileId)
    }
  }

  for (const c of otherChanges) {
    const f = c.file
    const isMedia = f ? mediaTypeOf(f.mimeType, f.name) !== null : knownMedia.has(c.fileId)
    if (!isMedia) continue
    const inTree = !gone(c) && (f!.parents ?? []).some((p) => folders.has(p))
    if (inTree) plan.upsertMedia.push(f!)
    else if (knownMedia.has(c.fileId)) plan.removeMedia.push(c.fileId)
  }

  return plan
}
