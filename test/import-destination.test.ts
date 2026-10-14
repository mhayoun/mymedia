import { describe, expect, it } from 'vitest'
import { insideDestination, type ImportItem } from '../src/import/importer'

const item = (relDir: string[]) => ({ key: relDir.join('/'), relDir }) as unknown as ImportItem

describe('insideDestination', () => {
  it('puts a folder picked into the album of its name in that album', () => {
    const out = insideDestination([item(['אסתי']), item(['אסתי', 'Purim'])], 'אסתי')
    expect(out.map((i) => i.relDir)).toEqual([[], ['Purim']])
  })
  it('ignores case and spaces', () => {
    expect(insideDestination([item(['esty '])], 'Esty')[0].relDir).toEqual([])
  })
  it('keeps the folder when the names differ', () => {
    expect(insideDestination([item(['אסתי'])], 'משפחה')[0].relDir).toEqual(['אסתי'])
  })
  it('keeps everything into the root, or when some files are outside the folder', () => {
    expect(insideDestination([item(['אסתי'])], undefined)[0].relDir).toEqual(['אסתי'])
    expect(insideDestination([item(['אסתי']), item([])], 'אסתי')[0].relDir).toEqual(['אסתי'])
  })
})
