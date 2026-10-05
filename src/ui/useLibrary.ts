// Joins Drive records, folders and mymedia.json data into gallery items.

import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, hasDb, type MediaRecord } from '../db/db'
import type { MediaMeta } from '../lib/metadata'
import { isReservedFolderName, placementOf, subtreeIds, type FolderNode, type Placement } from '../lib/tree'
import { useApp, type Filters, type SortMode } from '../store'

export const UNFILED = '__unfiled'

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
    if (!data || !rootId) return { ready: false, items: [], folders: new Map(), categories: [], unfiledCount: 0 }
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
    return { ready: true, items, folders, categories, unfiledCount }
  }, [data, rootId])
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortItems(items: LibraryItem[], sort: SortMode): LibraryItem[] {
  const out = [...items]
  if (sort === 'name') out.sort((a, b) => collator.compare(a.rec.name, b.rec.name))
  else {
    const dir = sort === 'newest' ? -1 : 1
    out.sort((a, b) => (a.rec.takenAt < b.rec.takenAt ? -dir : a.rec.takenAt > b.rec.takenAt ? dir : 0))
  }
  return out
}

export function filterItems(lib: Library, filters: Filters, rootId: string): LibraryItem[] {
  let items = lib.items
  if (filters.categoryId === UNFILED) items = items.filter((i) => i.rec.folderId === rootId)
  else if (filters.albumId) {
    const ids = subtreeIds(filters.albumId, lib.folders.values())
    items = items.filter((i) => ids.has(i.rec.folderId))
  } else if (filters.categoryId) items = items.filter((i) => i.place.categoryId === filters.categoryId)
  else items = items.filter((i) => !i.place.categoryId || !isReservedFolderName(i.place.category ?? ''))
  if (filters.type !== 'all') items = items.filter((i) => i.rec.type === filters.type)
  return items
}

export interface AlbumGroup {
  key: string
  category: string | null
  album: string | null
  items: LibraryItem[]
}

export function groupByAlbum(items: LibraryItem[]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>()
  for (const it of items) {
    const key = it.place.albumId ?? it.place.categoryId ?? 'root'
    let g = groups.get(key)
    if (!g) {
      g = { key, category: it.place.category, album: it.place.album, items: [] }
      groups.set(key, g)
    }
    g.items.push(it)
  }
  return [...groups.values()].sort((a, b) =>
    collator.compare(`${a.category ?? ''}\u0000${a.album ?? ''}`, `${b.category ?? ''}\u0000${b.album ?? ''}`),
  )
}
