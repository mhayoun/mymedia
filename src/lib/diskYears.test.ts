import { describe, expect, it } from 'vitest'
import { filesWithYear, folderYearOf, leadingYear, likelyYear, yearFolders } from './diskYears'
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
