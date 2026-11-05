import { describe, expect, it } from 'vitest'
import { publicLibraryIds, publicLink } from '../src/lib/publicLink'

describe('sharing by a link', () => {
  it('gives the library back from its link, and nothing from other addresses', () => {
    const link = publicLink('1l-u2dkNEAMQKMF7aocRJ4NhKxtHP6h-h', 'https://www.media-keep.com')
    expect(link).toBe('https://www.media-keep.com/?view=1l-u2dkNEAMQKMF7aocRJ4NhKxtHP6h-h')
    expect(publicLibraryIds(new URL(link).search)).toEqual(['1l-u2dkNEAMQKMF7aocRJ4NhKxtHP6h-h'])
    expect(publicLibraryIds('')).toBeNull()
    expect(publicLibraryIds('?view=../x')).toBeNull()
    expect(publicLibraryIds('?paypal=1')).toBeNull()
  })

  it('carries several albums chosen together in one link', () => {
    const link = publicLink(['1aaaaaaaaaaaaaaaaaaa', '1bbbbbbbbbbbbbbbbbbb'], 'https://www.media-keep.com')
    expect(link).toBe('https://www.media-keep.com/?view=1aaaaaaaaaaaaaaaaaaa,1bbbbbbbbbbbbbbbbbbb')
    expect(publicLibraryIds(new URL(link).search)).toEqual(['1aaaaaaaaaaaaaaaaaaa', '1bbbbbbbbbbbbbbbbbbb'])
    expect(publicLibraryIds('?view=1aaaaaaaaaaaaaaaaaaa,bad/id')).toBeNull()
  })
})
