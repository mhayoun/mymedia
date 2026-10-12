// Category / album management (categories = folders in the root, albums = sub-folders).

import { createNewFolder, FolderExistsError, findFolderNamed, getFile, renameFile, trashFile } from '../drive/api'
import { app } from '../store'
import { syncNow } from './engine'

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

export async function createCategory(name: string): Promise<void> {
  const rootId = app().rootId
  if (!rootId) return
  await createNewFolder(cleanName(name), rootId)
  await syncNow()
}

export async function createAlbum(name: string, parentId: string): Promise<void> {
  await createNewFolder(cleanName(name), parentId)
  await syncNow()
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const parent = (await getFile(id, 'id,parents')).parents?.[0]
  const same = parent ? await findFolderNamed(parent, cleanName(name), id) : null
  if (same) throw new FolderExistsError(same)
  await renameFile(id, cleanName(name))
  await syncNow()
}

/** Moves the folder and its content to Drive's trash (recoverable for 30 days). */
export async function deleteFolder(id: string): Promise<void> {
  await trashFile(id)
  const f = app().filters
  if (f.categoryId === id || f.albumId === id) app().setFilters({ categoryId: null, albumId: null })
  await syncNow()
}
