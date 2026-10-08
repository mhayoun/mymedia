import { describe, expect, it } from 'vitest'
import { cleanSpecies, katiaDate, katiaDescription, parseKatiaIndex, planKatiaImport, speciesInText, type PlanMedia } from './katia'

const index = JSON.stringify([
  { file: 'a.jpg', album: 'MyPhotos — צפרות', group: 'צפרות', date: 'Jan 26, 2026 6:17:00 am', description: 'דוכיפת בגינה', species: 'דוכיפת', context: 'בגינה' },
  { file: 'b.jpg', album: 'MyPhotos — צפרות', group: 'צפרות', date: null, description: 'מה זה?', species: '', context: '' },
  { file: 'c.jpg', album: 'דוכיפת', group: null, date: '2025-05-01T08:00:00.000Z', description: null, species: '', context: '' },
  { file: 'd.jpg', album: 'MyPhotos — צפרות', group: 'צפרות', date: null, description: null, species: '"איזה יופי" אמרה', context: '' },
  { file: 'e.jpg', album: 'MyPhotos — צפרות', group: null, date: null, description: null, species: 'בז מצוי', context: '' },
])

const media = (id: string, name: string, folderId: string, extra: Partial<PlanMedia> = {}): PlanMedia => ({
  id, name, folderId, takenAt: '2026-09-28T10:00:00.000Z', createdTime: '2026-09-28T10:00:00.000Z', hasOwnDate: false, ...extra,
})

describe('katia', () => {
  it('reads myphotos.json and rejects captions as species', () => {
    const e = parseKatiaIndex(index)
    expect(e).toHaveLength(5)
    expect(e[0].species).toBe('דוכיפת')
    expect(e[3].species).toBe('')
    expect(parseKatiaIndex('not json')).toEqual([])
    expect(cleanSpecies('one two three four')).toBe('')
  })

  it('parses Facebook and ISO dates as local time', () => {
    expect(katiaDate('Jan 26, 2026 6:17:00 am')).toBe('2026-01-26T06:17:00')
    expect(katiaDate('Jan 26, 2026 6:17:00 pm')).toBe('2026-01-26T18:17:00')
    expect(katiaDate('garbage')).toBeNull()
  })

  it('adds the context only when it is not already in the text', () => {
    expect(katiaDescription({ description: 'דוכיפת בגינה', context: 'בגינה' })).toBe('דוכיפת בגינה')
    expect(katiaDescription({ description: 'דוכיפת', context: 'חורף 2024' })).toBe('דוכיפת — חורף 2024')
  })

  it('finds a known species in a text', () => {
    expect(speciesInText('ראיתי היום דוכיפת בגינה!', ['דוכיפת', 'בז מצוי'])).toBe('דוכיפת')
    expect(speciesInText('בז מצוי על עמוד', ['בז', 'בז מצוי'])).toBe('בז מצוי')
    expect(speciesInText('שלום', ['דוכיפת'])).toBeNull()
  })

  it('plans: species → album, no species → category, own albums kept', () => {
    const folders = [
      { id: 'g', name: 'MyPhotos — צפרות', parentId: 'base' },
      { id: 'dk', name: 'דוכיפת', parentId: 'base' },
      { id: 'other', name: 'בז מצוי', parentId: 'base' },
    ]
    const plan = planKatiaImport(parseKatiaIndex(index), 'base', folders, [
      media('1', 'a.jpg', 'g'),
      media('2', 'b.jpg', 'g'),
      media('3', 'c.jpg', 'dk'),
      media('4', 'd.jpg', 'g'),
      media('5', 'e.jpg', 'other', { hasOwnDate: true }), // already moved by the user
      media('6', 'zzz.jpg', 'g'),
    ])
    const by = new Map(plan.actions.map((a) => [a.id, a]))
    expect(by.get('1')).toMatchObject({ moveTo: 'דוכיפת', species: 'דוכיפת', takenAt: '2026-01-26T06:17:00', group: 'צפרות' })
    expect(by.get('2')!.moveTo).toBe('')
    expect(by.get('3')!.moveTo).toBeUndefined() // its folder is a species album
    expect(by.get('4')!.moveTo).toBe('')
    expect(by.get('5')!.moveTo).toBeUndefined()
    expect(by.get('5')!.takenAt).toBeUndefined()
    expect(plan.unmatched).toBe(1)
    expect(plan.species.get('דוכיפת')).toBe(1)
    expect(plan.toReview).toBe(2)
    expect(plan.emptied).toEqual([]) // zzz.jpg stays in g
  })

  it('lists the Katia albums left empty', () => {
    const folders = [{ id: 'g', name: 'MyPhotos — צפרות', parentId: 'base' }]
    const plan = planKatiaImport(parseKatiaIndex(index), 'base', folders, [media('1', 'a.jpg', 'g'), media('2', 'b.jpg', 'g')])
    expect(plan.emptied).toEqual(['g'])
  })
})
