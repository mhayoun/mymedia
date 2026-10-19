import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/db/db', () => ({ db: () => ({}) }))
const { fileHashes } = await import('../src/models/references')

describe('fileHashes', () => {
  it('keeps the start of the Drive md5 and of the file it was made from', () => {
    expect(fileHashes({ md5: 'A'.repeat(32), appProperties: { mymedia_source_md5: 'b'.repeat(32) } })).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
    expect(fileHashes({ md5: 'c'.repeat(32), appProperties: { mymedia_source_md5: 'c'.repeat(32) } })).toEqual(['cccccccccccc'])
    expect(fileHashes({ md5: undefined, appProperties: undefined })).toEqual([])
    expect(fileHashes(undefined)).toEqual([])
  })
})
