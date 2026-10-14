import { describe, expect, it } from 'vitest'
import { insideDestination, type ImportItem } from '../src/import/importer'

const item = (relDir: string[]) => ({ key: relDir.join('/'), relDir }) as unknown as ImportItem

describe('insideDestination', () => {
  it('puts a folder picked into an album in that album, whatever its name', () => {
    const out = insideDestination([item(['esty']), item(['esty', 'Purim'])], true)
    expect(out.map((i) => i.relDir)).toEqual([[], ['Purim']])
  })
  it('keeps the folder as an album into the root or a category', () => {
    expect(insideDestination([item(['esty'])], false)[0].relDir).toEqual(['esty'])
  })
  it('keeps everything when the files are not all under one folder', () => {
    expect(insideDestination([item(['esty']), item([])], true)[0].relDir).toEqual(['esty'])
    expect(insideDestination([item(['a']), item(['b'])], true).map((i) => i.relDir)).toEqual([['a'], ['b']])
  })
})
