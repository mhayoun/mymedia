import { describe, expect, it } from 'vitest'
import { planChanges } from './changes'
import { dateFromFileName, detectOrigin, mediaTypeOf, parseExifDate, sizedThumbnailLink } from './media'
import { emptyMetaFile, mergeMetaFiles, parseMetaFile, type MediaMeta } from './metadata'
import { placementOf, subtreeIds, type FolderNode } from './tree'

const FOLDER = 'application/vnd.google-apps.folder'

describe('media', () => {
  it('detects supported types', () => {
    expect(mediaTypeOf('image/jpeg', 'a.jpg')).toBe('photo')
    expect(mediaTypeOf('application/octet-stream', 'a.HEIC')).toBe('photo')
    expect(mediaTypeOf('video/quicktime', 'a.mov')).toBe('video')
    expect(mediaTypeOf('application/pdf', 'a.pdf')).toBeNull()
  })

  it('parses EXIF and file-name dates', () => {
    expect(parseExifDate('2026:01:05 14:30:22')).toBe('2026-01-05T14:30:22')
    expect(parseExifDate('0000:00:00 00:00:00')).toBeUndefined()
    expect(dateFromFileName('IMG-20260105-WA0001.jpg')).toBe('2026-01-05T12:00:00')
    expect(dateFromFileName('20260105_143022.jpg')).toBe('2026-01-05T14:30:22')
    expect(dateFromFileName('PXL_20260105_143022123.jpg')).toBe('2026-01-05T14:30:22')
    expect(dateFromFileName('נחליאלי לבן.jpg')).toBeUndefined()
    expect(dateFromFileName('20261399_143022.jpg')).toBeUndefined()
  })

  it('detects origin', () => {
    expect(detectOrigin({ name: 'IMG-20260105-WA0001.jpg', type: 'photo', cameraMake: 'x' })).toBe('whatsapp')
    expect(detectOrigin({ name: 'x.jpg', type: 'photo', folderPath: 'WhatsApp Images' })).toBe('whatsapp')
    expect(detectOrigin({ name: 'bird.jpg', type: 'photo', cameraMake: 'Canon' })).toBe('camera')
    expect(detectOrigin({ name: 'PXL_20260105_143022123.mp4', type: 'video' })).toBe('camera')
    expect(detectOrigin({ name: 'Screenshot_20260105-143022.png', type: 'photo' })).toBe('unknown')
    expect(detectOrigin({ name: 'bird-wallpaper.webp', type: 'photo' })).toBe('web')
    expect(detectOrigin({ name: 'clip.mp4', type: 'video' })).toBe('unknown')
  })

  it('resizes thumbnail links', () => {
    expect(sizedThumbnailLink('https://lh3.x/abc=s220', 400)).toBe('https://lh3.x/abc=s400')
    expect(sizedThumbnailLink('https://lh3.x/abc', 400)).toBe('https://lh3.x/abc=s400')
  })
})

describe('metadata', () => {
  const item = (id: string, updatedAt: number, extra: Partial<MediaMeta> = {}): MediaMeta => ({
    id, name: id, type: 'photo', origin: 'camera', updatedAt, ...extra,
  })

  it('keeps the newest version of each item', () => {
    const a = { ...emptyMetaFile(), items: { x: item('x', 10, { description: 'old' }), y: item('y', 5) } }
    const b = { ...emptyMetaFile(), items: { x: item('x', 20, { description: 'new' }), z: item('z', 1) } }
    const m = mergeMetaFiles(a, b)
    expect(m.items.x.description).toBe('new')
    expect(Object.keys(m.items).sort()).toEqual(['x', 'y', 'z'])
  })

  it('drops old tombstones only', () => {
    const now = 200 * 24 * 3600 * 1000
    const a = { ...emptyMetaFile(), items: { old: item('old', 1, { deleted: true }), recent: item('recent', now - 1000, { deleted: true }) } }
    const m = mergeMetaFiles(a, emptyMetaFile(), now)
    expect(Object.keys(m.items)).toEqual(['recent'])
  })

  it('rejects unknown files', () => {
    expect(() => parseMetaFile('{"photos": []}')).toThrow()
    expect(parseMetaFile(JSON.stringify(emptyMetaFile())).items).toEqual({})
  })
})

describe('tree', () => {
  const folders = new Map<string, FolderNode>([
    ['birds', { id: 'birds', name: 'Birds', parentId: 'root' }],
    ['wag', { id: 'wag', name: 'נחליאלי לבן', parentId: 'birds' }],
    ['young', { id: 'young', name: 'young', parentId: 'wag' }],
  ])
  it('derives category and album', () => {
    expect(placementOf('root', folders, 'root')).toMatchObject({ category: null, album: null })
    expect(placementOf('birds', folders, 'root')).toMatchObject({ category: 'Birds', album: null })
    expect(placementOf('young', folders, 'root')).toMatchObject({ category: 'Birds', album: 'נחליאלי לבן / young', albumId: 'young' })
    expect(placementOf('elsewhere', folders, 'root').category).toBeNull()
  })
  it('lists subtrees', () => {
    expect([...subtreeIds('birds', folders.values())].sort()).toEqual(['birds', 'wag', 'young'])
  })
})

describe('changes', () => {
  const known = new Set(['root', 'birds'])
  const media = new Set(['m1', 'm2'])

  it('adds new folders even when children arrive first', () => {
    const plan = planChanges(
      [
        { fileId: 'sub', file: { id: 'sub', name: 'sub', mimeType: FOLDER, parents: ['new'] } },
        { fileId: 'new', file: { id: 'new', name: 'New', mimeType: FOLDER, parents: ['root'] } },
        { fileId: 'p', file: { id: 'p', name: 'p.jpg', mimeType: 'image/jpeg', parents: ['sub'] } },
      ],
      'root', known, media,
    )
    expect(plan.upsertFolders.map((f) => f.id)).toEqual(['new', 'sub'])
    expect(plan.scanFolders).toEqual(['new', 'sub'])
    expect(plan.upsertMedia.map((f) => f.id)).toEqual(['p'])
  })

  it('removes trashed, deleted and moved-out items', () => {
    const plan = planChanges(
      [
        { fileId: 'm1', removed: true },
        { fileId: 'm2', file: { id: 'm2', name: 'a.jpg', mimeType: 'image/jpeg', parents: ['outside'] } },
        { fileId: 'birds', file: { id: 'birds', name: 'Birds', mimeType: FOLDER, parents: ['root'], trashed: true } },
        { fileId: 'doc', file: { id: 'doc', name: 'a.pdf', mimeType: 'application/pdf', parents: ['root'] } },
      ],
      'root', known, media,
    )
    expect(plan.removeMedia.sort()).toEqual(['m1', 'm2'])
    expect(plan.removeFolders).toEqual(['birds'])
    expect(plan.upsertMedia).toEqual([])
  })

  it('flags a removed root', () => {
    expect(planChanges([{ fileId: 'root', removed: true }], 'root', known, media).rootRemoved).toBe(true)
  })
})
