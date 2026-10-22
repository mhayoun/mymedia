import { describe, expect, it } from 'vitest'
import { planRecovery } from '../src/lib/recover'
import type { MediaMeta, MetaFile } from '../src/lib/metadata'

const meta = (m: Partial<MediaMeta> & { id: string }): MediaMeta => ({ name: 'a.jpg', type: 'photo', origin: 'camera', updatedAt: 1, ...m }) as MediaMeta
const file = (items: MediaMeta[]): MetaFile => ({ format: 'mymedia', version: 1, updatedAt: 1, items: Object.fromEntries(items.map((i) => [i.id, i])) })

describe('planRecovery', () => {
  it('takes back only what is missing now', () => {
    const old = file([meta({ id: '1', imported: { from: 'birds', on: '2026-10-10' }, description: 'old', category: 'A', album: 'x' })])
    const r = planRecovery([meta({ id: '1', description: 'new', category: 'B', album: 'y' })], old)
    expect(r.patches.get('1')).toEqual({ imported: { from: 'birds', on: '2026-10-10' } })
    expect(r.counts).toEqual({ imported: 1 })
  })

  it('ignores removed photos and photos unknown to the old version', () => {
    const old = file([meta({ id: '1', group: 'g' }), meta({ id: '2', group: 'g' })])
    const r = planRecovery([meta({ id: '1', deleted: true }), meta({ id: '3' })], old)
    expect(r.patches.size).toBe(0)
  })

  it('brings back an origin chosen by hand, not a guessed one', () => {
    const old = file([meta({ id: '1', origin: 'whatsapp', originManual: true }), meta({ id: '2', origin: 'web' })])
    const r = planRecovery([meta({ id: '1', origin: 'camera' }), meta({ id: '2', origin: 'camera' })], old)
    expect(r.patches.get('1')).toEqual({ origin: 'whatsapp', originManual: true })
    expect(r.patches.has('2')).toBe(false)
  })

  it('does not bring back how the photo was being sorted', () => {
    const old = file([meta({ id: '1', toCheck: true, suggestions: [], confidence: 0.4, deleted: true, species: { he: 'שלדג' } })])
    const r = planRecovery([meta({ id: '1' })], old)
    expect(r.patches.get('1')).toEqual({ species: { he: 'שלדג' } })
  })
})
