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
  const renamed = await renameFile(id, cleanName(name))
  // The new name in the menu at once; a load already running may have read the old one.
  const named = () => db().folders.update(id, { name: renamed.name })
  await named()
  if (isSyncing()) {
    await syncNow()
    await named()
  }
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
  // The new place in the menu at once; a load already running may have read the old one.
  const placed = () => db().folders.update(id, { parentId: toId })
  await placed()
  if (isSyncing()) {
    await syncNow()
    await placed()
  }
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

/**
 * Puts albums of the root into categories (by name, created when missing), then loads once.
 * An album whose name is already taken in its category is left where it is (counted as failed).
 */
export async function putIntoCategories(
  moves: { id: string; category: string }[],
  onProgress: (done: number, failed: number) => void,
): Promise<{ moved: number; failed: number }> {
  const rootId = app().rootId
  if (!rootId) return { moved: 0, failed: moves.length }
  const categories = new Map<string, string>()
  const categoryId = async (name: string) => {
    const key = cleanName(name).toLocaleLowerCase()
    if (!categories.has(key)) categories.set(key, (await findFolderNamed(rootId, cleanName(name)))?.id ?? (await newFolder(name, rootId)).id)
    return categories.get(key)!
  }
  let moved = 0
  let failed = 0
  for (const m of moves) {
    try {
      const to = await categoryId(m.category)
      const f = await getFile(m.id, 'id,name')
      if (to === m.id || (await findFolderNamed(to, cleanName(f.name), m.id))) throw new FolderExistsError(f)
      await moveInto(m.id, to)
      await db().folders.update(m.id, { parentId: to })
      moved++
    } catch (e) {
      console.warn('[MyMedia] album not put into its category', m, e)
      failed++
    }
    onProgress(moved, failed)
  }
  await syncNow()
  // A load already running may have read the old places.
  for (const m of moves) {
    const to = categories.get(cleanName(m.category).toLocaleLowerCase())
    if (to && to !== m.id) await db().folders.update(m.id, { parentId: to })
  }
  return { moved, failed }
}
