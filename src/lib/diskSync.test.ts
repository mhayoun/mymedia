import { describe, expect, it } from 'vitest'
import { emptiedFolders, isAlbumOf, planDiskSync, type SyncInput, type SyncMedia } from './diskSync'
import type { WalkedFile } from './importPlan'
import type { FolderNode } from './tree'

const R = 'root'
const folders = new Map<string, FolderNode>(
  [
    { id: 'voy', name: 'Voyages', parentId: R },
    { id: 'eg', name: '2015 EinGuedi', parentId: 'voy' },
    { id: 'eg-nik', name: '873NIKON', parentId: 'eg' },
    { id: 'par', name: 'Paris', parentId: 'voy' },
    { id: 'fam', name: 'Famille', parentId: R },
    { id: 'anniv', name: 'anniv papa', parentId: 'fam' },
  ].map((f) => [f.id, f]),
)
const disk = (dirs: string[], name: string, size: number): WalkedFile => ({ dirs, name, size, type: 'photo' })
const media = (id: string, name: string, size: number, folderId: string, extra: Partial<SyncMedia> = {}): SyncMedia => ({
  id,
  name,
  size,
  folderId,
  takenAt: '2015-04-01T10:00:00',
  imported: true,
  ...extra,
})
const input = (d: WalkedFile[], m: SyncMedia[]): SyncInput => ({
  disk: d,
  media: m,
  folders,
  rootId: R,
  diskName: 'My Pictures',
  diskPath: 'E:\\My Pictures',
  categoryOf: (n) => (/anniv|mariage/i.test(n) ? 'Famille' : null),
  yearFirst: true,
})

describe('planDiskSync', () => {
  it('nothing to do when MyMedia is like the disk (year first, sub-folder, compressed HEIC)', () => {
    const p = planDiskSync(
      input(
        [disk(['EinGuedi2015'], 'a.jpg', 100), disk(['EinGuedi2015', '873NIKON'], 'b.HEIC', 5000), disk(['anniv papa'], 'c.jpg', 7)],
        [media('a', 'a.jpg', 100, 'eg'), media('b', 'b.jpg', 900, 'eg-nik', { originalSize: 5000 }), media('c', 'c.jpg', 7, 'anniv')],
      ),
    )
    expect(p.moves).toEqual([])
    expect(p.missing).toEqual([])
    expect(p.matched).toBe(3)
    expect(p.albums.every((a) => !a.renamedFrom && a.albumId)).toBe(true)
  })

  it('a folder renamed on the disk renames its album', () => {
    const p = planDiskSync(input([disk(['Paris 2019'], 'p1.jpg', 1), disk(['Paris 2019'], 'p2.jpg', 2)], [media('p1', 'p1.jpg', 1, 'par'), media('p2', 'p2.jpg', 2, 'par')]))
    expect(p.albums).toHaveLength(1)
    expect(p.albums[0]).toMatchObject({ albumId: 'par', name: '2019 Paris', renamedFrom: 'Paris', categoryId: 'voy' })
    expect(p.moves).toEqual([])
  })

  it('photos moved to another folder, and a new folder', () => {
    const p = planDiskSync(
      input(
        [
          disk(['Paris'], 'p1.jpg', 1),
          disk(['anniv papa'], 'p2.jpg', 2),
          disk(['mariage Avi'], 'a.jpg', 100),
          disk(['mariage Avi'], 'new.jpg', 55),
          disk(['EinGuedi2015'], 'e1.jpg', 11),
          disk(['EinGuedi2015'], 'e2.jpg', 12),
        ],
        [media('p1', 'p1.jpg', 1, 'par'), media('p2', 'p2.jpg', 2, 'par'), media('a', 'a.jpg', 100, 'eg'), media('e1', 'e1.jpg', 11, 'eg'), media('e2', 'e2.jpg', 12, 'eg')],
      ),
    )
    const mariage = p.albums.find((a) => a.diskName === 'mariage Avi')!
    expect(mariage).toMatchObject({ albumId: null, name: '2015 mariage Avi', categoryId: 'fam', categoryName: 'Famille' })
    const to = (id: string) => p.albums[p.moves.find((m) => m.mediaId === id)!.album].diskName
    expect(to('p2')).toBe('anniv papa')
    expect(to('a')).toBe('mariage Avi')
    expect(p.moves.some((m) => m.mediaId === 'p1')).toBe(false)
    expect(p.notInMyMedia).toBe(1)
  })

  it('one photo moved to a new folder does not rename its old album', () => {
    const p = planDiskSync(
      input(
        [disk(['Paris'], 'p1.jpg', 1), disk(['Paris'], 'p2.jpg', 2), disk(['Paris'], 'p3.jpg', 3), disk(['Louvre'], 'p4.jpg', 4)],
        [media('p1', 'p1.jpg', 1, 'par'), media('p2', 'p2.jpg', 2, 'par'), media('p3', 'p3.jpg', 3, 'par'), media('p4', 'p4.jpg', 4, 'par')],
      ),
    )
    expect(p.albums.find((a) => a.diskName === 'Paris')).toMatchObject({ albumId: 'par' })
    expect(p.albums.find((a) => a.diskName === 'Louvre')).toMatchObject({ albumId: null, categoryId: 'voy' })
    expect(p.moves.map((m) => m.mediaId)).toEqual(['p4'])
  })

  it('files removed from the disk (imported from it) are listed; others are not', () => {
    const p = planDiskSync(
      input(
        [disk(['Paris'], 'p1.jpg', 1)],
        [
          media('p1', 'p1.jpg', 1, 'par'),
          media('gone', 'gone.jpg', 3, 'par'),
          media('phone', 'phone.jpg', 4, 'par', { imported: false }),
          media('other', 'o.jpg', 5, 'anniv', { importedPath: 'D:\\Other\\anniv papa' }),
          media('here', 'h.jpg', 6, 'anniv', { importedPath: 'E:\\My Pictures\\anniv papa' }),
        ],
      ),
    )
    expect(p.missing.map((m) => m.mediaId).sort()).toEqual(['gone', 'here'])
  })

  it('folders emptied by the moves', () => {
    const m = [media('a', 'a.jpg', 1, 'eg-nik'), media('b', 'b.jpg', 2, 'par'), media('c', 'c.jpg', 3, 'anniv')]
    expect(emptiedFolders(m, folders, R, new Set(['a']), new Set())).toEqual(['eg'])
    expect(emptiedFolders(m, folders, R, new Set(['a']), new Set(['eg']))).toEqual(['eg-nik'])
    expect(emptiedFolders(m, folders, R, new Set(['b', 'c']), new Set())).toEqual(['par', 'anniv'])
  })

  it('a folder moved and renamed with the year: same album, its original folder follows the disk', () => {
    const f = new Map(folders)
    f.set('esty', { id: 'esty', name: '2015 EstyAnniversaire13ans', parentId: 'fam' })
    const p = planDiskSync({
      ...input(
        [disk(['My Pictures2015', '2015_EstyAnniversaire13ans'], 'e1.jpg', 10), disk(['My Pictures2015', '2015_EstyAnniversaire13ans'], 'e2.jpg', 20)],
        [
          media('e1', 'e1.jpg', 10, 'esty', { importedPath: 'myBackup/My Pictures/EstyAnniversaire13ans' }),
          media('e2', 'e2.jpg', 20, 'esty', { importedPath: 'E:\\myBackup\\My Pictures\\EstyAnniversaire13ans' }),
        ],
      ),
      folders: f,
      diskName: 'myBackup',
      diskPath: '',
    })
    expect(p.moves).toEqual([])
    expect(p.albums[0]).toMatchObject({ albumId: 'esty', name: '2015 EstyAnniversaire13ans' })
    expect(p.albums[0].renamedFrom).toBeUndefined()
    expect(p.paths).toEqual([
      { mediaId: 'e1', path: 'myBackup/My Pictures2015/2015_EstyAnniversaire13ans', from: '2015_EstyAnniversaire13ans' },
      { mediaId: 'e2', path: 'E:\\myBackup\\My Pictures2015\\2015_EstyAnniversaire13ans', from: '2015_EstyAnniversaire13ans' },
    ])
  })

  it('album names: separators and a missing year', () => {
    expect(isAlbumOf('2015 EstyAnniv', '2015_EstyAnniv')).toBe(true)
    expect(isAlbumOf('EstyAnniv', '2015_EstyAnniv')).toBe(true)
    expect(isAlbumOf('2015 EstyAnniv', 'EstyAnniv2015')).toBe(true)
    expect(isAlbumOf('2014 EstyAnniv', '2015_EstyAnniv')).toBe(false)
    expect(isAlbumOf('Paris', 'Louvre')).toBe(false)
  })
})
