import { describe, expect, it } from 'vitest'
import { groupStranded } from '../src/transfer/reclaim'

describe('groupStranded', () => {
  it('groups by folder path, the biggest first', () => {
    const g = groupStranded([
      { id: 'a', name: 'a.jpg', path: ['ציפורים', 'דוכיפת'] },
      { id: 'b', name: 'b.jpg', path: ['ציפורים', 'חסידה'] },
      { id: 'c', name: 'c.jpg', path: ['ציפורים', 'חסידה'] },
      { id: 'd', name: 'd.jpg', path: [] },
    ])
    expect(g).toEqual([
      { path: ['ציפורים', 'חסידה'], count: 2 },
      { path: ['ציפורים', 'דוכיפת'], count: 1 },
      { path: [], count: 1 },
    ])
  })
})
