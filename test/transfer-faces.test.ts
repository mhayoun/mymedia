import { describe, expect, it } from 'vitest'
import { planImport, type TransferFaces } from '../src/faces/transfer'

const face = (id: string, mediaId: string, personId: string | null, extra = {}) => ({
  id,
  mediaId,
  version: 'v1',
  box: [0, 0, 0.1, 0.1] as [number, number, number, number],
  score: 0.9,
  emb: btoa('\x01\x02'),
  personId,
  by: 'manual' as const,
  updatedAt: 1,
  ...extra,
})

describe('planImport (people that come with transferred photos)', () => {
  const data: TransferFaces = {
    persons: [
      { id: 'pA', name: 'Maman', updatedAt: 1 },
      { id: 'pB', name: 'David', updatedAt: 1 },
      { id: 'pC', updatedAt: 1, mergedInto: 'pA' },
    ],
    faces: [
      face('m1#0', 'm1', 'pA', { rejected: ['pB'] }),
      face('m1#1', 'm1', 'pB'),
      face('m2#0', 'm2', null, { suggested: 'pA' }),
      face('m3#0', 'm3', 'pB'),
    ],
  }
  const version = new Map([
    ['m1', 'v1'],
    ['m2', 'v1'],
    ['m3', 'v2'],
  ])
  const plan = planImport(data, version, [{ id: 'mine1', name: 'maman', updatedAt: 0 }], 5)

  it('joins a person of the same name, keeps the others', () => {
    expect(plan.persons.map((p) => p.id).sort()).toEqual(['pB', 'pC'])
    expect(plan.persons.find((p) => p.id === 'pC')?.mergedInto).toBe('mine1')
    const m1 = plan.faces.filter((f) => f.mediaId === 'm1')
    expect(m1.map((f) => f.personId)).toEqual(['mine1', 'pB'])
    expect(m1[0].rejected).toEqual(['pB'])
    expect(plan.faces.find((f) => f.id === 'm2#0')).toMatchObject({ personId: null, suggested: 'mine1' })
  })

  it('leaves out photos not here or changed since', () => {
    expect(plan.mediaIds.sort()).toEqual(['m1', 'm2'])
    expect([...plan.faces[0].emb]).toEqual([1, 2])
  })
})
