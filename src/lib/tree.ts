// Folder tree helpers: root → categories (level 1) → albums (level 2+).

export interface FolderNode {
  id: string
  name: string
  parentId: string
}

export interface Placement {
  category: string | null
  album: string | null
  /** Folder ids of the category and the album (null when not applicable). */
  categoryId: string | null
  albumId: string | null
}

export const ALBUM_SEPARATOR = ' / '

/** Folders whose name starts with "_" (e.g. _Originals, _Inbox) are reserved, not categories. */
export function isReservedFolderName(name: string): boolean {
  return name.startsWith('_')
}

/** Folder chain from the first level below the root down to folderId, or null if outside. */
export function folderChain(folderId: string, folders: ReadonlyMap<string, FolderNode>, rootId: string): FolderNode[] | null {
  const chain: FolderNode[] = []
  let id = folderId
  const seen = new Set<string>()
  while (id !== rootId) {
    const node = folders.get(id)
    if (!node || seen.has(id)) return null
    seen.add(id)
    chain.unshift(node)
    id = node.parentId
  }
  return chain
}

const PENDING = 'new:'

/**
 * An album of an installed model that is not in Drive yet: it is created when
 * the first photo goes into it. Drive ids have no ':', so the id is safe to split.
 */
export function pendingAlbumId(categoryId: string, path: string): string {
  return `${PENDING}${categoryId}:${path}`
}

export function parsePendingAlbum(id: string): { categoryId: string; path: string[] } | null {
  if (!id.startsWith(PENDING)) return null
  const rest = id.slice(PENDING.length)
  const at = rest.indexOf(':')
  if (at < 1) return null
  return { categoryId: rest.slice(0, at), path: rest.slice(at + 1).split(ALBUM_SEPARATOR) }
}

export function placementOf(folderId: string, folders: ReadonlyMap<string, FolderNode>, rootId: string): Placement {
  const pending = parsePendingAlbum(folderId)
  if (pending) {
    const category = folders.get(pending.categoryId)
    if (!category || category.parentId !== rootId) return { category: null, album: null, categoryId: null, albumId: null }
    return { category: category.name, categoryId: category.id, album: pending.path.join(ALBUM_SEPARATOR), albumId: null }
  }
  const chain = folderChain(folderId, folders, rootId)
  if (!chain || chain.length === 0) return { category: null, album: null, categoryId: null, albumId: null }
  const album = chain.slice(1)
  return {
    category: chain[0].name,
    categoryId: chain[0].id,
    album: album.length ? album.map((f) => f.name).join(ALBUM_SEPARATOR) : null,
    albumId: album.length ? album[album.length - 1].id : null,
  }
}

/** All folder ids below (and including) folderId. */
export function subtreeIds(folderId: string, folders: Iterable<FolderNode>): Set<string> {
  const children = new Map<string, string[]>()
  for (const f of folders) {
    const list = children.get(f.parentId)
    if (list) list.push(f.id)
    else children.set(f.parentId, [f.id])
  }
  const out = new Set<string>([folderId])
  const stack = [folderId]
  while (stack.length) {
    const id = stack.pop()!
    for (const c of children.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c)
        stack.push(c)
      }
    }
  }
  return out
}
