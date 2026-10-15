import { describe, expect, it } from 'vitest'
import { insideDestination, knownFiles, pickedFolder, type ImportItem } from '../src/import/importer'

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

describe('knownFiles', () => {
  it('knows a compressed file by its original: MD5, or size and date when it was compressed before', () => {
    const k = knownFiles([
      { md5: 'aaa' },
      { md5: 'compressed1', appProperties: { mymedia_source_md5: 'orig1', mymedia_original_size: '5000', mymedia_taken: '2024-05-01T10:00:00' } },
      { md5: 'compressed2', appProperties: { mymedia_compressed: '1', mymedia_original_size: '7000', mymedia_taken: '2023-01-02T08:30:00' } },
    ])
    expect([...k.md5].sort()).toEqual(['aaa', 'compressed1', 'compressed2', 'orig1'])
    expect(k.sizeDate.has('7000|2023-01-02T08:30:00')).toBe(true)
    expect(k.sizeDate.has('7000|2023-01-02T08:31:00')).toBe(false)
  })
})
