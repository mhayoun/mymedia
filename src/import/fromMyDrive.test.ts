import { describe, expect, it } from 'vitest'
import { diskName, numbered } from './fromMyDrive'

describe('names on the disk', () => {
  it('keeps names Windows accepts', () => {
    expect(diskName('DSC_0615.JPG')).toBe('DSC_0615.JPG')
    expect(diskName('a/b:c*?.jpg')).toBe('a_b_c__.jpg')
    expect(diskName('Ski 2015. ')).toBe('Ski 2015')
    expect(diskName('...')).toBe('_')
    expect(diskName('ציפורים')).toBe('ציפורים')
  })
  it('numbers a name already taken', () => {
    expect(numbered('DSC_1.jpg', 2)).toBe('DSC_1 (2).jpg')
    expect(numbered('README', 3)).toBe('README (3)')
  })
})
