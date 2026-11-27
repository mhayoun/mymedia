import { describe, expect, it } from 'vitest'
import { diskName, numbered } from './diskBackup'
import { nameFromDates } from './fromMyDrive'

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

describe('album name from the dates', () => {
  it('names by month, year or years', () => {
    expect(nameFromDates(['2025-08-23T08:50:15', '2025-08-24T10:00:00'])).toBe('2025_08')
    expect(nameFromDates(['2025-08-23T08:50:15', '2025-11-02T10:00:00'])).toBe('2025')
    expect(nameFromDates(['2016-01-01T00:00:00', '2014-05-02T10:00:00', '2015-03-03T10:00:00'])).toBe('2014-2016')
    expect(nameFromDates([])).toBe('')
  })
})
