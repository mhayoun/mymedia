import { describe, expect, it } from 'vitest'
import type { MediaMeta } from './metadata'
import { buildProvenance, importSourceName, provenanceKeys } from './provenance'

const meta = (id: string, extra: Partial<MediaMeta>): MediaMeta => ({ id, name: `${id}.jpg`, type: 'photo', origin: 'import', updatedAt: 1, ...extra })

describe('provenance', () => {
  it('lists groups (biggest first) and imports (newest first)', () => {
    const p = buildProvenance([
      meta('a', { group: 'צפרות', imported: { from: 'folder001', on: '2026-10-10' } }),
      meta('b', { group: 'צפרות' }),
      meta('c', { group: 'Birds' }),
      meta('d', { imported: { from: 'folder001', on: '2026-10-10' } }),
      meta('e', { imported: { from: 'facebook-export', on: '2026-09-01' } }),
      meta('f', { imported: { from: 'אמא 8', on: '', via: 'katia' } }),
      undefined,
    ])
    expect(p.groups.map((g) => [g.label, g.count])).toEqual([['צפרות', 2], ['Birds', 1]])
    expect(p.imports.map((i) => [i.label, i.on, i.count])).toEqual([['folder001', '2026-10-10', 2], ['facebook-export', '2026-09-01', 1], ['אמא 8', '', 1]])
  })

  it('gives the filter keys of a media', () => {
    expect(provenanceKeys(meta('a', { group: 'G', imported: { from: 'f', on: '2026-10-10' } }))).toEqual(['g:G', 'i:2026-10-10||f'])
    expect(provenanceKeys(undefined)).toEqual([])
  })

  it('names what was imported', () => {
    expect(importSourceName({ relDirs: [[], ['folder001', 'sub']] })).toBe('folder001')
    expect(importSourceName({ zipName: 'facebook-moshe.zip', relDirs: [] })).toBe('facebook-moshe')
    expect(importSourceName({ relDirs: [[]] })).toBe('')
  })
})
