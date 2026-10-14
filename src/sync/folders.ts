// Category / album management (categories = folders in the root, albums = sub-folders).

import { createNewFolder, FolderExistsError, findFolderNamed, getFile, moveInto, renameFile, trashFile } from '../drive/api'
import { db } from '../db/db'
import { folderChain } from '../lib/tree'
import { app } from '../store'
import { syncNow } from './engine'

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** Creates the category and shows it. */
export async function createCategory(name: string): Promise<void> {
  const rootId = app().rootId
  if (!rootId) return
  const f = await createNewFolder(cleanName(name), rootId)
  await syncNow()
  app().setFilters({ categoryId: f.id, albumId: null, personId: null, provenance: null })
}

/** Creates the album and shows it. */
export async function createAlbum(name: string, parentId: string): Promise<void> {
  const f = await createNewFolder(cleanName(name), parentId)
  await syncNow()
  const folders = new Map((await db().folders.toArray()).map((x) => [x.id, x]))
  // From the parent, which is known even if Drive has not reported the new folder yet.
  const categoryId = folderChain(parentId, folders, app().rootId!)?.[0]?.id ?? parentId
  app().setFilters({ categoryId, albumId: f.id, personId: null, provenance: null })
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const parent = (await getFile(id, 'id,parents')).parents?.[0]
  const same = parent ? await findFolderNamed(parent, cleanName(name), id) : null
  if (same) throw new FolderExistsError(same)
  await renameFile(id, cleanName(name))
  await syncNow()
}

/**
 * Puts a category or album, with all it holds, into another folder: into the
 * root it becomes a category, into a folder it becomes an album of it. The
 * files stay the same in Drive (dates, names, people kept).
 */
export async function moveFolder(id: string, toId: string): Promise<void> {
  const f = await getFile(id, 'id,name')
  const same = await findFolderNamed(toId, cleanName(f.name), id)
  if (same) throw new FolderExistsError(same)
  await moveInto(id, toId)
  await syncNow()
}

/** Moves the folder and its content to Drive's trash (recoverable for 30 days). */
export async function deleteFolder(id: string): Promise<void> {
  await trashFile(id)
  const f = app().filters
  if (f.categoryId === id || f.albumId === id) app().setFilters({ categoryId: null, albumId: null })
  await syncNow()
}
