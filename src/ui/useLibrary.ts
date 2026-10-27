// Joins Drive records, folders and mymedia.json data into gallery items.

import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, hasDb, type MediaRecord } from '../db/db'
import type { MediaMeta } from '../lib/metadata'
import { ALBUM_SEPARATOR, folderChain, isReservedFolderName, placementOf, subtreeIds, type FolderNode, type Placement } from '../lib/tree'
import { buildProvenance, provenanceKeys, type Provenance } from '../lib/provenance'
import { inPeriod } from '../lib/periods'
import { compressionState, matchesQuery, searchText } from '../lib/search'
import { useApp, type Filters, type SortMode } from '../store'

export const UNFILED = '__unfiled'
/** Media waiting at the root or directly in a category that has albums. */
export const TO_CLASSIFY = '__toClassify'
/** Media moved automatically and not yet reviewed. */
export const AUTO = '__auto'
/** Album photos that look more like another album ("Possibly misfiled"). */
export const MISFILED = '__misfiled'
/** The "People" screen. */
export const PEOPLE = '__people'

export interface LibraryItem {
  rec: MediaRecord
  meta?: MediaMeta
  place: Placement
}

export interface FolderInfo extends FolderNode {
  count: number
  children: FolderInfo[]
}

export interface Library {
  ready: boolean
  items: LibraryItem[]
  folders: Map<string, FolderNode>
  categories: FolderInfo[]
  unfiledCount: number
  toClassify: LibraryItem[]
  autoItems: LibraryItem[]
  /** Facebook groups and imports, with their number of media. */
  provenance: Provenance
}

export function useLibrary(): Library {
  const rootId = useApp((s) => s.rootId)
  const user = useApp((s) => s.user)
  const data = useLiveQuery(
    async () => {
      if (!hasDb()) return null
      const d = db()
      const [media, folders, meta] = await Promise.all([d.media.toArray(), d.folders.toArray(), d.meta.toArray()])
      return { media, folders, meta }
    },
    [user?.email, rootId],
  )

  return useMemo(() => {
    if (!data || !rootId)
      return { ready: false, items: [], folders: new Map(), categories: [], unfiledCount: 0, toClassify: [], autoItems: [], provenance: { groups: [], imports: [] } }
    const folders = new Map(data.folders.map((f) => [f.id, f]))
    const metas = new Map(data.meta.map((m) => [m.id, m]))
    const items: LibraryItem[] = []
    const directCount = new Map<string, number>()
    let unfiledCount = 0
    for (const rec of data.media) {
      const place = placementOf(rec.folderId, folders, rootId)
      items.push({ rec, meta: metas.get(rec.id), place })
      if (rec.folderId === rootId) unfiledCount++
      directCount.set(rec.folderId, (directCount.get(rec.folderId) ?? 0) + 1)
    }

    const byParent = new Map<string, FolderNode[]>()
    for (const f of data.folders) {
      const list = byParent.get(f.parentId)
      if (list) list.push(f)
      else byParent.set(f.parentId, [f])
    }
    const build = (f: FolderNode): FolderInfo => {
      const children = (byParent.get(f.id) ?? []).map(build).sort((a, b) => collator.compare(a.name, b.name))
      const count = (directCount.get(f.id) ?? 0) + children.reduce((n, c) => n + c.count, 0)
      return { ...f, count, children }
    }
    const categories = (byParent.get(rootId) ?? [])
      .filter((f) => !isReservedFolderName(f.name))
      .map(build)
      .sort((a, b) => collator.compare(a.name, b.name))
    const categoriesWithAlbums = new Set(categories.filter((c) => c.children.length > 0).map((c) => c.id))
    const toClassify = items.filter(
      (i) =>
        !i.meta?.keepHere &&
        (i.rec.folderId === rootId ||
          categoriesWithAlbums.has(i.rec.folderId) ||
          // In a category whose albums come from a model and are not created yet.
          (!!i.meta?.suggestions?.length && folders.get(i.rec.folderId)?.parentId === rootId)),
    )
    const autoItems = items.filter((i) => i.meta?.auto)
    const provenance = buildProvenance(items.map((i) => i.meta))
    return { ready: true, items, folders, categories, unfiledCount, toClassify, autoItems, provenance }
  }, [data, rootId])
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortItems(items: LibraryItem[], sort: SortMode): LibraryItem[] {
  const out = [...items]
  if (sort === 'name') out.sort((a, b) => collator.compare(a.rec.name, b.rec.name))
  else if (sort === 'largest') out.sort((a, b) => b.rec.size - a.rec.size)
  else if (sort === 'smallest') out.sort((a, b) => a.rec.size - b.rec.size)
  else {
    const dir = sort === 'newest' ? -1 : 1
    out.sort((a, b) => (a.rec.takenAt < b.rec.takenAt ? -dir : a.rec.takenAt > b.rec.takenAt ? dir : 0))
  }
  return out
}

export function filterItems(lib: Library, filters: Filters, rootId: string, personMedia?: Set<string>): LibraryItem[] {
  return applyExtraFilters(placeFilter(lib, filters, rootId, personMedia), filters, lib)
}

/** Search words, origin, classification and compression filters. */
function applyExtraFilters(items: LibraryItem[], f: Filters, lib: Library): LibraryItem[] {
  if (f.type !== 'all') items = items.filter((i) => i.rec.type === f.type)
  if (f.period) items = items.filter((i) => inPeriod(i.rec.takenAt, f.period!))
  if (f.origin) items = items.filter((i) => (i.meta?.origin ?? 'unknown') === f.origin)
  if (f.compression) items = items.filter((i) => compressionState(i.rec.appProperties, i.meta) === f.compression)
  if (f.status) {
    const waiting = new Set(lib.toClassify.map((i) => i.rec.id))
    items = items.filter((i) =>
      f.status === 'toCheck'
        ? !!i.meta?.toCheck
        : f.status === 'auto'
          ? !!i.meta?.auto
          : f.status === 'toClassify'
            ? waiting.has(i.rec.id)
            : !waiting.has(i.rec.id) && !!i.place.categoryId,
    )
  }
  if (f.query?.trim()) items = items.filter((i) => matchesQuery(searchText(i.rec.name, i.meta, i.place.category, i.place.album), f.query!))
  return items
}

function placeFilter(lib: Library, filters: Filters, rootId: string, personMedia?: Set<string>): LibraryItem[] {
  let items = lib.items
  if (filters.personId && personMedia) return items.filter((i) => personMedia.has(i.rec.id))
  if (filters.provenance) return items.filter((i) => provenanceKeys(i.meta).includes(filters.provenance!))
  if (filters.categoryId === TO_CLASSIFY) items = lib.toClassify
  else if (filters.categoryId === AUTO) items = lib.autoItems
  else if (filters.categoryId === UNFILED) items = items.filter((i) => i.rec.folderId === rootId)
  else if (filters.albumId) {
    const ids = subtreeIds(filters.albumId, lib.folders.values())
    items = items.filter((i) => ids.has(i.rec.folderId))
  } else if (filters.categoryId) items = items.filter((i) => i.place.categoryId === filters.categoryId)
  else items = items.filter((i) => !i.place.categoryId || !isReservedFolderName(i.place.category ?? ''))
  return items
}

export interface AlbumGroup {
  key: string
  category: string | null
  album: string | null
  items: LibraryItem[]
}

/**
 * Media by album. In an open folder (`under`), one group per sub-folder of it:
 * what is deeper goes into its sub-folder's group. Albums are in name order
 * when `byName`; otherwise in the order of the sorted items (newest first: the
 * album with the newest photo first).
 */
export function groupByAlbum(
  items: LibraryItem[],
  under?: { id: string; folders: ReadonlyMap<string, FolderNode>; rootId: string },
  byName = true,
): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>()
  for (const it of items) {
    let key = it.place.albumId ?? it.place.categoryId ?? 'root'
    let category = it.place.category
    let album = it.place.album
    const chain = under ? folderChain(it.rec.folderId, under.folders, under.rootId) : null
    const at = chain ? chain.findIndex((f) => f.id === under!.id) : -1
    if (chain && at >= 0) {
      const shown = chain.slice(0, Math.min(at + 2, chain.length))
      key = shown[shown.length - 1].id
      category = shown[0].name
      album = shown.length > 1 ? shown.slice(1).map((f) => f.name).join(ALBUM_SEPARATOR) : null
    }
    let g = groups.get(key)
    if (!g) {
      g = { key, category, album, items: [] }
      groups.set(key, g)
    }
    g.items.push(it)
  }
  if (!byName) return [...groups.values()]
  return [...groups.values()].sort((a, b) =>
    collator.compare(`${a.category ?? ''}\u0000${a.album ?? ''}`, `${b.category ?? ''}\u0000${b.album ?? ''}`),
  )
}

/** The category all these media are in, or null. */
export function commonCategory(lib: Library, ids: string[], rootId: string): string | null {
  const byId = new Map(lib.items.map((i) => [i.rec.id, i.rec.folderId]))
  let found: string | null = null
  for (const id of ids) {
    const folderId = byId.get(id)
    const cat = folderId ? placementOf(folderId, lib.folders, rootId).categoryId : null
    if (!cat || (found && cat !== found)) return null
    found = cat
  }
  return found
}
