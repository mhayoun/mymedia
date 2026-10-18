import { describe, expect, it, vi } from 'vitest'

const FOLDER = 'application/vnd.google-apps.folder'
const tree: Record<string, { id: string; name: string; mimeType: string }[]> = {
  trip: [
    { id: 'p1', name: 'a.jpg', mimeType: 'image/jpeg' },
    { id: 'day', name: 'Day 1', mimeType: FOLDER },
  ],
  day: [{ id: 'v1', name: 'b.mp4', mimeType: 'video/mp4' }],
}
vi.mock('../src/drive/api', () => ({
  FILE_FIELDS: '',
  childrenQuery: (ids: string[]) => ids[0],
  listFiles: async (q: string, onPage: (f: unknown[]) => void) => onPage(tree[q.split(' ')[0]] ?? []),
  copyFile: vi.fn(),
  ensureFolderPath: vi.fn(),
}))
vi.mock('../src/sync/engine', () => ({ syncNow: vi.fn(), toRecord: vi.fn() }))
vi.mock('../src/sync/metaStore', () => ({ markMetaDirty: vi.fn() }))
vi.mock('../src/db/db', () => ({ db: vi.fn() }))

const { collect, takenAtOf } = await import('../src/import/fromDrive')

describe('import from Google Drive', () => {
  it('takes the photos and videos of a chosen folder, with the folders on the way', async () => {
    const out = await collect([{ id: 'trip', name: 'Trip', mimeType: FOLDER }], () => undefined)
    expect(out.map((e) => [e.file.id, e.relDir.join('/')]).sort()).toEqual([
      ['p1', 'Trip'],
      ['v1', 'Trip/Day 1'],
    ])
  })

  it('dates a file from the photo, else its name, else when it was put in Drive', () => {
    expect(takenAtOf({ id: '1', name: 'x.jpg', mimeType: 'image/jpeg', imageMediaMetadata: { time: '2021:05:04 10:11:12' } })).toBe('2021-05-04T10:11:12')
    expect(takenAtOf({ id: '2', name: 'IMG-20200101-WA0001.jpg', mimeType: 'image/jpeg' })).toBe('2020-01-01T12:00:00')
    expect(takenAtOf({ id: '3', name: 'x.jpg', mimeType: 'image/jpeg', createdTime: '2019-03-02T08:00:00Z' })).toMatch(/^2019-03-0[12]T/)
  })
})

describe('topShared', () => {
  it('keeps what was shared, not what is inside a shared folder nor what this account owns', async () => {
    const { topShared } = await import('../src/import/fromDrive')
    const out = topShared([
      { id: 'f', name: 'נחל יהודיה', mimeType: FOLDER },
      { id: 'in', name: 'IMG_1.JPG', mimeType: 'image/jpeg', parents: ['f'] },
      { id: 'alone', name: 'IMG_2.JPG', mimeType: 'image/jpeg', parents: ['notVisible'] },
      { id: 'noParent', name: 'IMG_3.JPG', mimeType: 'image/jpeg' },
      { id: 'mine', name: 'Camera', mimeType: FOLDER, ownedByMe: true },
    ])
    expect(out.map((f) => f.id)).toEqual(['f', 'alone', 'noParent'])
  })
})
