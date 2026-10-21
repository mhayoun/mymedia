import { describe, expect, it } from 'vitest'
import type { MediaRecord } from '../src/db/db'
import { packGroups, packHash, readPack, writePack } from '../src/sync/thumbPacks'

const rec = (id: string, folderId: string, takenAt: string): MediaRecord =>
  ({ id, folderId, takenAt, name: id, mimeType: 'image/jpeg', type: 'photo', size: 1, createdTime: takenAt, modifiedTime: takenAt, md5: `m${id}` }) as MediaRecord

describe('thumbnail packs', () => {
  it('groups by folder, oldest first, 60 a pack', () => {
    const media = Array.from({ length: 70 }, (_, i) => rec(`a${i}`, 'F', `2020-01-01T00:00:${String(i % 60).padStart(2, '0')}`))
    media.push(rec('b', 'G', '2021-01-01T00:00:00'))
    const g = packGroups(media)
    expect([...g.keys()].sort()).toEqual(['F.0', 'F.1', 'G.0'])
    expect(g.get('F.0')!.length).toBe(60)
    expect(g.get('F.1')!.length).toBe(10)
  })
  it('hash changes with a photo', () => {
    const a = [rec('1', 'F', '2020'), rec('2', 'F', '2021')]
    expect(packHash(a)).toBe(packHash([...a]))
    expect(packHash(a)).not.toBe(packHash([a[0]]))
  })
  it('reads what it wrote', async () => {
    const blob = await writePack([
      { id: 'x', version: 'v1', blob: new Blob([new Uint8Array([0xff, 0xd8, 3])]) },
      { id: 'y', version: 'v2', blob: new Blob([new Uint8Array([0xff, 0xd8])]) },
    ])
    const items = readPack(new Uint8Array(await blob.arrayBuffer()))
    expect(items.map((i) => [i.id, i.version, i.blob.size])).toEqual([['x', 'v1', 3], ['y', 'v2', 2]])
    expect([...new Uint8Array(await items[1].blob.arrayBuffer())]).toEqual([0xff, 0xd8])
  })
})
