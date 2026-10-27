import { describe, expect, it } from 'vitest'
import { buildPeriods, inPeriod, periodLabel, periodOf } from '../src/lib/periods'

describe('periods', () => {
  it('reads the year and month of local and ISO dates', () => {
    expect(periodOf('2024-03-05T10:00:00', 'year')).toBe('2024')
    expect(periodOf('2024-03-05T10:00:00.000Z', 'month')).toBe('2024-03')
    expect(periodOf(undefined, 'year')).toBeNull()
    expect(periodOf('', 'month')).toBeNull()
  })

  it('matches a year or a month', () => {
    expect(inPeriod('2024-03-05T10:00:00', '2024')).toBe(true)
    expect(inPeriod('2024-03-05T10:00:00', '2024-03')).toBe(true)
    expect(inPeriod('2024-03-05T10:00:00', '2024-04')).toBe(false)
    expect(inPeriod(undefined, '2024')).toBe(false)
  })

  it('counts years and months, newest first', () => {
    const p = buildPeriods(['2023-12-01T00:00:00', '2024-01-02T00:00:00', '2024-03-01T00:00:00', '2024-03-09T00:00:00', undefined])
    expect(p).toEqual([
      { year: '2024', count: 3, months: [{ key: '2024-03', count: 2 }, { key: '2024-01', count: 1 }] },
      { year: '2023', count: 1, months: [{ key: '2023-12', count: 1 }] },
    ])
  })

  it('names a month in the language shown', () => {
    expect(periodLabel('2024', 'fr-FR')).toBe('2024')
    expect(periodLabel('2024-03', 'fr-FR')).toBe('mars 2024')
    expect(periodLabel('2024-03', 'en-US')).toBe('March 2024')
  })
})
