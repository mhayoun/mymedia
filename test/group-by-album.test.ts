import { describe, expect, it } from 'vitest'
import { groupByAlbum, sortItems, type LibraryItem } from '../src/ui/useLibrary'

const item = (id: string, album: string, takenAt: string) =>
  ({ rec: { id, takenAt, name: id, size: 1 }, place: { albumId: album, categoryId: 'c', category: 'Cat', album } }) as unknown as LibraryItem

describe('groupByAlbum', () => {
  const items = sortItems([item('a1', 'Alpha', '2020-01-01T10:00:00'), item('z1', 'Zeta', '2026-10-01T10:00:00'), item('a2', 'Alpha', '2024-01-01T10:00:00')], 'newest')

  it('puts the album with the newest photo first when sorted by date', () => {
    const groups = groupByAlbum(items, undefined, false)
    expect(groups.map((g) => g.album)).toEqual(['Zeta', 'Alpha'])
    expect(groups[1].items.map((i) => i.rec.id)).toEqual(['a2', 'a1'])
  })

  it('keeps albums in name order when sorted by name', () => {
    expect(groupByAlbum(items).map((g) => g.album)).toEqual(['Alpha', 'Zeta'])
  })
})
