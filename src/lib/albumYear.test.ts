import { describe, expect, it } from 'vitest'
import { mostYear, nameHasYear, yearFirst } from './albumYear'

describe('yearFirst', () => {
  it('keeps a name that starts with its year', () => {
    expect(yearFirst('2004_10_04_AnnivAsher8', null, 2026)).toBe('2004_10_04_AnnivAsher8')
    expect(yearFirst('2018 Efrat Ganim', 2020, 2026)).toBe('2018 Efrat Ganim')
  })
  it('moves a year found inside the name to the start', () => {
    expect(yearFirst('TyoulJerusalem2015', null, 2026)).toBe('2015 TyoulJerusalem')
    expect(yearFirst('anniv papa 2012 maison', null, 2026)).toBe('2012 anniv papa maison')
    expect(yearFirst('mariage_2016_avishai', null, 2026)).toBe('2016 mariage avishai')
    expect(yearFirst('Pourim - 2014', null, 2026)).toBe('2014 Pourim')
  })
  it('does not take other numbers for a year', () => {
    expect(yearFirst('Asher8', null, 2026)).toBe('Asher8')
    expect(yearFirst('Pourim5773', 2013, 2026)).toBe('2013 Pourim5773')
    expect(yearFirst('photos 12345', null, 2026)).toBe('photos 12345')
    expect(yearFirst('vacances 2031', 2019, 2026)).toBe('2019 vacances 2031')
  })
  it('puts the photos year when the name has none', () => {
    expect(yearFirst('mariageAvishai', 2016, 2026)).toBe('2016 mariageAvishai')
    expect(yearFirst('mariageAvishai', null, 2026)).toBe('mariageAvishai')
  })
  it('a name that is only a year stays', () => {
    expect(yearFirst('2015', null, 2026)).toBe('2015')
  })
})

describe('nameHasYear', () => {
  it('finds a year at the start or inside', () => {
    expect(nameHasYear('TyoulJerusalem2015', 2026)).toBe(true)
    expect(nameHasYear('Asher8', 2026)).toBe(false)
    expect(nameHasYear('Pourim5773', 2026)).toBe(false)
  })
})

describe('mostYear', () => {
  it('gives the year of most dates, the earliest of equals', () => {
    expect(mostYear(['2015-03-01T10:00:00', '2015-04-01T10:00:00', '2016-01-01T10:00:00'])).toBe(2015)
    expect(mostYear(['2016-01-01T10:00:00', '2015-04-01T10:00:00'])).toBe(2015)
    expect(mostYear([])).toBe(null)
  })
})
