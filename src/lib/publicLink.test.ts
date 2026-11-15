import { describe, expect, it } from 'vitest'
import { personShareLink, publicLibraryIds, publicPersonId } from './publicLink'

describe('person link', () => {
  it('round-trips the list file id', () => {
    const link = personShareLink('1AbCdEfGhIjKlMnOp_q-r', 'https://www.media-keep.com')
    expect(link).toBe('https://www.media-keep.com/?person=1AbCdEfGhIjKlMnOp_q-r')
    expect(publicPersonId(new URL(link).search)).toBe('1AbCdEfGhIjKlMnOp_q-r')
  })
  it('refuses a bad id, and is not a library link', () => {
    expect(publicPersonId('?person=../x')).toBeNull()
    expect(publicPersonId('')).toBeNull()
    expect(publicLibraryIds('?person=1AbCdEfGhIjKlMnOp')).toBeNull()
  })
})
