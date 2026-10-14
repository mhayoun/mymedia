import { describe, expect, it } from 'vitest'
import { insideDestination, pickedFolder, type ImportItem } from '../src/import/importer'

const item = (relDir: string[]) => ({ key: relDir.join('/'), relDir }) as unknown as ImportItem

describe('insideDestination', () => {
  it('creates the picked folder in the destination by default', () => {
    expect(insideDestination([item(['esty']), item(['esty', 'Purim'])], true).map((i) => i.relDir)).toEqual([['esty'], ['esty', 'Purim']])
  })
  it('without it, the photos go straight into the destination, sub-folders as albums', () => {
    expect(insideDestination([item(['esty']), item(['esty', 'Purim'])], false).map((i) => i.relDir)).toEqual([[], ['Purim']])
  })
  it('knows the picked folder only when every file is inside it', () => {
    expect(pickedFolder([item(['esty']), item(['esty', 'Purim'])])).toBe('esty')
    expect(pickedFolder([item(['esty']), item([])])).toBeNull()
    expect(pickedFolder([item(['a']), item(['b'])])).toBeNull()
    expect(insideDestination([item(['a']), item(['b'])], false).map((i) => i.relDir)).toEqual([['a'], ['b']])
  })
})
