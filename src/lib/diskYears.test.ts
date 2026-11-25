import { describe, expect, it } from 'vitest'
import { clockAhead, clockUnset, clockWrong, filesWithYear, folderYearOf, leadingYear, likelyYear, yearFolders, yearsTo } from './diskYears'
import type { WalkedFile } from './importPlan'

const f = (dirs: string[], name: string, type: WalkedFile['type'] = 'photo'): WalkedFile => ({ dirs, name, size: 1, type })

describe('leadingYear', () => {
  it('reads the year at the start of a name', () => {
    expect(leadingYear('2015_Ski', 2026)).toBe(2015)
    expect(leadingYear('2015 Ski', 2026)).toBe(2015)
    expect(leadingYear('2015-Ski', 2026)).toBe(2015)
    expect(leadingYear('2015', 2026)).toBe(2015)
  })
  it('ignores other numbers and years elsewhere', () => {
    expect(leadingYear('20150_Ski', 2026)).toBeNull()
    expect(leadingYear('Ski_2015', 2026)).toBeNull()
    expect(leadingYear('1975_Old', 2026)).toBeNull()
    expect(leadingYear('2030_Future', 2026)).toBeNull()
    expect(leadingYear('Divers', 2026)).toBeNull()
  })
})

describe('folderYearOf', () => {
  it('takes the nearest folder with a year', () => {
    expect(folderYearOf(['Voyages', '2015_Ski', 'Jour 1'], 2026)).toEqual({ dirs: ['Voyages', '2015_Ski'], year: 2015 })
    expect(folderYearOf(['2014_All', '2015_Ski'], 2026)).toEqual({ dirs: ['2014_All', '2015_Ski'], year: 2015 })
    expect(folderYearOf(['Voyages', 'Ski'], 2026)).toBeNull()
    expect(folderYearOf([], 2026)).toBeNull()
  })
  it('leaves documents and files without a year folder out', () => {
    const list = filesWithYear([f(['2015_Ski'], 'a.jpg'), f(['2015_Ski'], 'a.pdf', 'document'), f(['Ski'], 'b.jpg')], 2026)
    expect(list.map((x) => x.file.name)).toEqual(['a.jpg'])
  })
})

describe('yearFolders', () => {
  const ski = ['2015_Ski']
  const item = (name: string, takenAt: string, source = 'exif', folder = ski, year = 2015) => ({ file: f(folder, name), takenAt, source, folder, year })

  it('lists the files of another year, not the undated ones', () => {
    const [g] = yearFolders([
      item('ok.jpg', '2015-02-01T10:00:00'),
      item('ok2.jpg', '2015-02-02T10:00:00'),
      item('late.jpg', '2016-01-01T00:30:00'),
      item('early.mp4', '2014-12-31T23:00:00', 'video'),
      item('copied.jpg', '2020-05-05T12:00:00', 'file'),
    ])
    expect(g.checked).toBe(5)
    expect(g.wrong.map((w) => w.file.name)).toEqual(['early.mp4', 'late.jpg'])
    expect(g.undated.map((w) => w.file.name)).toEqual(['copied.jpg'])
    expect(likelyYear(g)).toBeNull()
  })

  it('tells the likely year when most files are of another one', () => {
    const [g] = yearFolders([item('a.jpg', '2016-03-01T10:00:00'), item('b.jpg', '2016-03-02T10:00:00'), item('c.jpg', '2015-03-02T10:00:00', 'name')])
    expect(likelyYear(g)).toBe(2016)
  })

  it('puts the folders with the most wrong files first', () => {
    const other = ['2010_Mariage']
    const list = yearFolders([item('a.jpg', '2015-01-01T10:00:00'), item('b.jpg', '2011-01-01T10:00:00', 'exif', other, 2010)])
    expect(list.map((g) => g.dirs[0])).toEqual(['2010_Mariage', '2015_Ski'])
  })
})

describe('camera clock wrong', () => {
  // 153_0053.JPG: EXIF 2009-07-08, copied from the card on 2008-08-29.
  const copied = new Date(2008, 7, 29, 15, 33, 42).getTime()
  const item = (name: string, takenAt: string, source = 'exif', modified = copied) => ({
    file: f(['2008_Nofesh'], name), takenAt, source, modified, folder: ['2008_Nofesh'], year: 2008,
  })

  it('tells a camera date later than the copy on the disk', () => {
    expect(clockAhead(item('a.jpg', '2009-07-08T00:57:35'))).toBe(true)
    expect(clockAhead(item('a.jpg', '2008-08-29T20:00:00'))).toBe(false)
    expect(clockAhead(item('a.jpg', '2009-07-08T00:57:35', 'name'))).toBe(false)
    expect(clockAhead({ ...item('a.jpg', '2009-07-08T00:57:35'), modified: undefined })).toBe(false)
  })

  it('keeps the folder name right when the clock was wrong', () => {
    const [g] = yearFolders([item('a.jpg', '2009-07-08T00:57:35'), item('b.jpg', '2009-07-24T01:20:20', 'exif', copied + 38000)])
    expect(g.ahead).toBe(2)
    expect(g.copiedOn).toBe(copied)
    expect(clockWrong(g)).toBe(true)
    expect(likelyYear(g)).toBeNull()
  })

  it('gives the years to shift to the folder year', () => {
    expect(yearsTo('2009-07-08T00:57:35', 2008)).toBe(-1)
    expect(yearsTo('2000-01-01T00:00:00', 2008)).toBe(8)
  })
})

describe('camera clock never set', () => {
  // 2011_bayit / IMG_0004.jpg (Canon A2200): EXIF 1980-01-01 00:00:20; Image0041.jpg (Nokia): EXIF 2010-01-08, file the same day.
  const bayit = ['2011_bayit']
  const item = (name: string, takenAt: string, source = 'exif', modified?: number) => ({
    file: f(bayit, name), takenAt, source, modified, folder: bayit, year: 2011,
  })

  it('tells the 1st of January at midnight of an earlier year', () => {
    expect(clockUnset(item('a.jpg', '1980-01-01T00:00:20'), 2011)).toBe(true)
    expect(clockUnset(item('a.jpg', '2000-01-01T02:10:00', 'video'), 2011)).toBe(true)
    expect(clockUnset(item('a.jpg', '2010-01-08T10:00:00'), 2011)).toBe(false)
    expect(clockUnset(item('a.jpg', '2010-01-01T20:00:00'), 2011)).toBe(false)
    expect(clockUnset(item('a.jpg', '2012-01-01T00:10:00'), 2011)).toBe(false)
    expect(clockUnset(item('a.jpg', '1980-01-01T00:00:20', 'name'), 2011)).toBe(false)
  })

  it('sorts the camera mistakes from the true dates', () => {
    const nokia = new Date(2010, 0, 8, 9, 0, 0).getTime()
    const [g] = yearFolders([
      item('IMG_0004.jpg', '1980-01-01T00:00:20', 'exif', new Date(1979, 11, 31, 23, 0, 20).getTime()),
      item('IMG_0009.jpg', '1980-01-01T00:01:00'),
      item('Image0041.jpg', '2010-01-08T10:00:00', 'exif', nokia),
      item('IMG_0100.jpg', '2011-08-01T10:00:00'),
    ])
    expect(g.wrong.map((w) => [w.file.name, w.why])).toEqual([
      ['IMG_0004.jpg', 'unset'],
      ['IMG_0009.jpg', 'unset'],
      ['Image0041.jpg', 'other'],
    ])
    expect(g.unset).toBe(2)
    expect(g.ahead).toBe(0)
    // 1 true date of another year out of 2: not enough to say the folder's name is wrong.
    expect(likelyYear(g)).toBeNull()
  })
})
