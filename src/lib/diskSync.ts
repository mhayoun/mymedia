// "Sync with the disk": after folders were renamed, photos moved from one folder to another, folders made or
// removed on the disk, MyMedia is put back like the disk. Each file of the disk is found again in MyMedia (by
// its name without extension and its size, or its size before compression), then where it is on the disk
// says where it goes: its album (the same rules as the import: albumOf), and the sub-folders below it.
// The category is not on the disk: an album keeps its own; a new one takes the category proposed.
// Pure, tested; ui/DiskSyncDialog applies it.

import { mostYear, yearFirst } from './albumYear'
import { albumOf, type WalkedFile } from './importPlan'
import { folderChain, type FolderNode } from './tree'

export interface SyncMedia {
  id: string
  name: string
  size: number
  /** Size of the file on the disk, when it was compressed at import. */
  originalSize?: number
  folderId: string
  takenAt: string
  /** Imported (from a disk, a ZIP, a phone's folder…): only such files can be "no longer on the disk". */
  imported: boolean
  /** Where its folder was on the computer, when known ("E:\\Photos\\EinGuedi2015"). */
  importedPath?: string
}

export interface SyncInput {
  disk: WalkedFile[]
  media: SyncMedia[]
  folders: ReadonlyMap<string, FolderNode>
  rootId: string
  /** The folder read (its name) and where it is on the computer, if typed ('' when not known). */
  diskName: string
  diskPath: string
  /** The category proposed for a new album (by its name on the disk), or null (in the root). */
  categoryOf: (albumName: string) => string | null
  /** The year first in the names of new or renamed albums (as at the import). */
  yearFirst: boolean
}

/** Where an album of the disk goes in MyMedia. */
export interface SyncAlbum {
  /** Its name on the disk (as the import names it). */
  diskName: string
  /** Its name in MyMedia after the sync. */
  name: string
  /** Its MyMedia album, or null: made by the sync. */
  albumId: string | null
  /** Its category: an existing folder id, or a name to find or make (null: in the root). */
  categoryId: string | null
  categoryName: string | null
  /** The album had another name (renamed on the disk). */
  renamedFrom?: string
  files: number
}

export interface SyncMove {
  mediaId: string
  name: string
  /** Index in `albums`. */
  album: number
  /** Folders below the album ("873NIKON"). */
  sub: string[]
  /** Where it is now, as a path ("Voyages / EinGuedi2015"). */
  from: string
}

export interface SyncMissing {
  mediaId: string
  name: string
  where: string
}

export interface SyncPlan {
  albums: SyncAlbum[]
  moves: SyncMove[]
  /** In MyMedia, imported from this disk, no longer on it. */
  missing: SyncMissing[]
  /** Files of the disk found in MyMedia. */
  matched: number
  /** Files of the disk's albums not found in MyMedia (not imported yet, or a copy of another one). */
  notInMyMedia: number
}

const base = (name: string) => name.replace(/\.[^.]+$/, '').trim().toLocaleLowerCase()
const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()

/** Whether a MyMedia album is this disk folder's: its name, or its name with the year put first. */
export function isAlbumOf(albumName: string, folder: string): boolean {
  if (same(albumName.trim(), folder.trim()) || same(albumName.trim(), yearFirst(folder))) return true
  const m = /^(\d{4}) (.+)$/.exec(albumName.trim())
  return !!m && same(m[2], folder.trim())
}

/** A media's album (the folder below its category; a folder alone in the root) and the folders below it. */
function placeOf(folderId: string, folders: ReadonlyMap<string, FolderNode>, rootId: string, hasChildren: Set<string>) {
  const chain = folderChain(folderId, folders, rootId)
  if (!chain?.length) return null
  if (chain.length === 1) return hasChildren.has(chain[0].id) ? null : { album: chain[0], category: null as FolderNode | null, sub: [] as string[] }
  return { album: chain[1], category: chain[0], sub: chain.slice(2).map((f) => f.name) }
}

const pathText = (folderId: string, folders: ReadonlyMap<string, FolderNode>, rootId: string) =>
  (folderChain(folderId, folders, rootId) ?? []).map((f) => f.name).join(' / ')

export function planDiskSync(input: SyncInput): SyncPlan {
  const { folders, rootId } = input
  const hasChildren = new Set([...folders.values()].map((f) => f.parentId))

  // Each disk file found again: by its name (without extension: HEIC → JPG, MOV → MP4) and size.
  const byKey = new Map<string, SyncMedia[]>()
  const add = (k: string, m: SyncMedia) => (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(m)
  for (const m of input.media) {
    add(`${base(m.name)}|${m.size}`, m)
    if (m.originalSize && m.originalSize !== m.size) add(`${base(m.name)}|${m.originalSize}`, m)
  }
  const used = new Set<string>()
  const groups = new Map<string, { files: { disk: WalkedFile; media: SyncMedia; sub: string[] }[]; unmatched: number }>()
  for (const f of input.disk) {
    const a = albumOf(f.dirs)
    if (!a) continue
    const g = groups.get(a.name) ?? groups.set(a.name, { files: [], unmatched: 0 }).get(a.name)!
    const candidates = (byKey.get(`${base(f.name)}|${f.size}`) ?? []).filter((m) => !used.has(m.id))
    // Two copies: the one already in an album of this name first.
    const m =
      candidates.find((c) => {
        const p = placeOf(c.folderId, folders, rootId, hasChildren)
        return p && isAlbumOf(p.album.name, a.name)
      }) ?? candidates[0]
    if (!m) {
      g.unmatched++
      continue
    }
    used.add(m.id)
    g.files.push({ disk: f, media: m, sub: f.dirs.slice(a.dir.length) })
  }

  // Each album of the disk: the MyMedia album of its name, else the one most of its files are in
  // (renamed on the disk), else a new one.
  const albumsOfMyMedia = [...folders.values()].filter((f) => {
    const chain = folderChain(f.id, folders, rootId)
    return chain && (chain.length === 2 || (chain.length === 1 && !hasChildren.has(f.id)))
  })
  const taken = new Set<string>()
  const albums: SyncAlbum[] = []
  const indexOf = new Map<string, number>()
  const names = [...groups.keys()].filter((n) => groups.get(n)!.files.length > 0)
  // The biggest first: they keep their album when two disk folders come from one.
  names.sort((x, y) => groups.get(y)!.files.length - groups.get(x)!.files.length)
  const counts = (n: string) => {
    const c = new Map<string, number>()
    for (const { media } of groups.get(n)!.files) {
      const p = placeOf(media.folderId, folders, rootId, hasChildren)
      if (p) c.set(p.album.id, (c.get(p.album.id) ?? 0) + 1)
    }
    return c
  }
  const finalName = (n: string) => {
    if (!input.yearFirst) return n
    return yearFirst(n, mostYear(groups.get(n)!.files.map((f) => f.media.takenAt).filter(Boolean)))
  }
  const assign = (n: string, album: FolderNode | null) => {
    const files = groups.get(n)!.files.length
    if (album) {
      taken.add(album.id)
      const chain = folderChain(album.id, folders, rootId)!
      const category = chain.length === 2 ? chain[0] : null
      const keep = isAlbumOf(album.name, n)
      indexOf.set(n, albums.length)
      albums.push({
        diskName: n,
        name: keep ? album.name : finalName(n),
        albumId: album.id,
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? null,
        ...(keep ? {} : { renamedFrom: album.name }),
        files,
      })
      return
    }
    // Without a category proposed for its name: the one most of its files come from.
    const from = new Map<string, number>()
    for (const { media } of groups.get(n)!.files) {
      const c = placeOf(media.folderId, folders, rootId, hasChildren)?.category
      if (c) from.set(c.name, (from.get(c.name) ?? 0) + 1)
    }
    const categoryName = input.categoryOf(n) ?? [...from.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
    const category = categoryName ? [...folders.values()].find((f) => f.parentId === rootId && same(f.name, categoryName)) : undefined
    indexOf.set(n, albums.length)
    albums.push({ diskName: n, name: finalName(n), albumId: null, categoryId: category?.id ?? null, categoryName, files })
  }
  // Files of the disk now in each MyMedia album (an album renamed: most of its files go to one folder).
  const inAlbum = new Map<string, number>()
  for (const g of groups.values())
    for (const { media } of g.files) {
      const p = placeOf(media.folderId, folders, rootId, hasChildren)
      if (p) inAlbum.set(p.album.id, (inAlbum.get(p.album.id) ?? 0) + 1)
    }
  const left: string[] = []
  for (const n of names) {
    const c = counts(n)
    const byName = albumsOfMyMedia.filter((f) => !taken.has(f.id) && isAlbumOf(f.name, n)).sort((x, y) => (c.get(y.id) ?? 0) - (c.get(x.id) ?? 0))[0]
    if (byName) assign(n, byName)
    else left.push(n)
  }
  for (const n of left) {
    const c = counts(n)
    const total = groups.get(n)!.files.length
    const [bestId, best] = [...c.entries()].filter(([id]) => !taken.has(id)).sort((x, y) => y[1] - x[1])[0] ?? ['', 0]
    // Most of its files: the same album, renamed (not one whose own name is another disk folder's).
    const album = best * 2 > total && best * 2 > (inAlbum.get(bestId) ?? 0) ? folders.get(bestId)! : null
    const ownName = album && names.some((o) => o !== n && isAlbumOf(album.name, o))
    assign(n, album && !ownName ? album : null)
  }
  albums.sort((x, y) => x.name.localeCompare(y.name))
  for (const [i, a] of albums.entries()) indexOf.set(a.diskName, i)

  const moves: SyncMove[] = []
  for (const [n, g] of groups) {
    const i = indexOf.get(n)
    if (i === undefined) continue
    const target = albums[i]
    for (const { media, sub } of g.files) {
      const p = placeOf(media.folderId, folders, rootId, hasChildren)
      const here = p && target.albumId === p.album.id && p.sub.length === sub.length && p.sub.every((s, k) => same(s, sub[k]))
      if (!here) moves.push({ mediaId: media.id, name: media.name, album: i, sub, from: pathText(media.folderId, folders, rootId) })
    }
  }

  // Imported from this disk (its path says so, or it is in one of the disk's albums), not found on it.
  const diskPath = norm(input.diskPath)
  const diskName = norm(input.diskName)
  const synced = new Set(albums.map((a) => a.albumId).filter(Boolean))
  const missing: SyncMissing[] = []
  for (const m of input.media) {
    if (used.has(m.id) || !m.imported) continue
    const p = placeOf(m.folderId, folders, rootId, hasChildren)
    const path = m.importedPath ? norm(m.importedPath) : null
    const fromDisk = path
      ? (diskPath && path.startsWith(`${diskPath}/`)) || path.split('/')[0] === diskName
      : !!p && synced.has(p.album.id)
    if (fromDisk) missing.push({ mediaId: m.id, name: m.name, where: pathText(m.folderId, folders, rootId) })
  }
  return {
    albums,
    moves,
    missing,
    matched: used.size,
    notInMyMedia: [...groups.values()].reduce((n, g) => n + g.unmatched, 0),
  }
}

/**
 * Folders (albums and their sub-folders, not categories) left without any photo once these files have
 * left them, and that no album of the sync keeps: the highest of each branch.
 */
export function emptiedFolders(
  media: Pick<SyncMedia, 'id' | 'folderId'>[],
  folders: ReadonlyMap<string, FolderNode>,
  rootId: string,
  leaving: ReadonlySet<string>,
  kept: ReadonlySet<string>,
): string[] {
  const staying = new Set<string>()
  const left = new Set<string>()
  for (const m of media) {
    const mark = leaving.has(m.id) ? left : staying
    for (let id: string | undefined = m.folderId; id && id !== rootId; id = folders.get(id)?.parentId) mark.add(id)
  }
  const empty = (id: string) => left.has(id) && !staying.has(id) && !kept.has(id) && (folderChain(id, folders, rootId)?.length ?? 0) >= 2
  return [...left].filter((id) => {
    if (!empty(id)) return false
    const parent = folders.get(id)?.parentId
    return !(parent && empty(parent))
  })
}
