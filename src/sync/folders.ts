// Category / album management (categories = folders in the root, albums = sub-folders).

import { createNewFolder, FolderExistsError, findFolderNamed, getFile, moveInto, renameFile, trashFile } from '../drive/api'
import { db } from '../db/db'
import { folderChain } from '../lib/tree'
import { app } from '../store'
import { forgetFolder, isSyncing, madeFolder, syncNow } from './engine'

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/**
 * Creates a folder and puts it in the menu at once (a load from Drive running
 * meanwhile may not report it yet).
 */
export async function newFolder(name: string, parentId: string): Promise<{ id: string; name: string }> {
  const f = await createNewFolder(cleanName(name), parentId)
  const rec = { id: f.id, name: f.name, parentId }
  madeFolder(rec)
  await db().folders.put(rec)
  return f
}

/** Shows a category or album (and what it is in). */
export async function showFolder(id: string): Promise<void> {
  const rootId = app().rootId!
  const folders = new Map((await db().folders.toArray()).map((x) => [x.id, x]))
  const chain = folderChain(id, folders, rootId)
  const categoryId = chain?.[0]?.id ?? id
  app().setFilters({ categoryId, albumId: categoryId === id ? null : id, personId: null, provenance: null })
}

/** Creates the category and shows it. */
export async function createCategory(name: string): Promise<void> {
  const rootId = app().rootId
  if (!rootId) return
  const f = await newFolder(name, rootId)
  await showFolder(f.id)
  void syncNow()
}

/** Creates the album and shows it. */
export async function createAlbum(name: string, parentId: string): Promise<void> {
  const f = await newFolder(name, parentId)
  await showFolder(f.id)
  void syncNow()
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
  await forgetFolder(id)
  // A load already running may have read Drive before the deletion: let it end, then load again.
  if (isSyncing()) await syncNow()
  await forgetFolder(id)
  await syncNow()
}
