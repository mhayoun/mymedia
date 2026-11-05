import { describe, expect, it } from 'vitest'
import { publicLibraryId, publicLink } from '../src/lib/publicLink'

describe('sharing by a link', () => {
  it('gives the library back from its link, and nothing from other addresses', () => {
    const link = publicLink('1l-u2dkNEAMQKMF7aocRJ4NhKxtHP6h-h', 'https://www.media-keep.com')
    expect(link).toBe('https://www.media-keep.com/?view=1l-u2dkNEAMQKMF7aocRJ4NhKxtHP6h-h')
    expect(publicLibraryId(new URL(link).search)).toBe('1l-u2dkNEAMQKMF7aocRJ4NhKxtHP6h-h')
    expect(publicLibraryId('')).toBeNull()
    expect(publicLibraryId('?view=../x')).toBeNull()
    expect(publicLibraryId('?paypal=1')).toBeNull()
  })
})
