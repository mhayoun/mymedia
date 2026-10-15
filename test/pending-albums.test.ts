import { describe, expect, it } from 'vitest'
import { allowedFor, isCandidate, type ClassifyData } from '../src/classify/data'
import type { MediaRecord } from '../src/db/db'
import { parsePendingAlbum, pendingAlbumId, placementOf, type FolderNode } from '../src/lib/tree'

const folders = new Map<string, FolderNode>([
  ['birds', { id: 'birds', name: 'Birds', parentId: 'root' }],
  ['owl', { id: 'owl', name: 'Owl', parentId: 'birds' }],
])

describe('pending albums of a model', () => {
  it('keeps the category and the path, sub-albums and colons included', () => {
    const id = pendingAlbumId('birds', 'Kingfishers / שלדג גמדי: male')
    expect(parsePendingAlbum(id)).toEqual({ categoryId: 'birds', path: ['Kingfishers', 'שלדג גמדי: male'] })
    expect(parsePendingAlbum('owl')).toBeNull()
  })
  it('is shown like an album of its category', () => {
    expect(placementOf(pendingAlbumId('birds', 'Kingfishers / Pied'), folders, 'root')).toMatchObject({
      category: 'Birds',
      categoryId: 'birds',
      album: 'Kingfishers / Pied',
    })
    expect(placementOf(pendingAlbumId('gone', 'Pied'), folders, 'root').category).toBeNull()
  })
  it('makes photos of a category with no album yet classifiable, into the pending albums', () => {
    const pied = pendingAlbumId('fish', 'Trout')
    const data: ClassifyData = {
      rootId: 'root',
      folders: new Map([...folders, ['fish', { id: 'fish', name: 'Fish', parentId: 'root' }]]),
      media: [],
      meta: new Map(),
      vecs: new Map(),
      pending: new Map([['fish', [pied]], ['birds', [pendingAlbumId('birds', 'Pied')]]]),
    }
    const rec = (folderId: string) => ({ id: 'x', folderId }) as MediaRecord
    expect(isCandidate(rec('fish'), data)).toBe(true)
    expect(allowedFor(rec('fish'), data)).toEqual([pied])
    expect(allowedFor(rec('birds'), data)).toEqual(['owl', pendingAlbumId('birds', 'Pied')])
    expect(isCandidate(rec('fish'), { ...data, pending: undefined })).toBe(false)
  })
})
