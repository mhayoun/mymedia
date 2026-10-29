import { describe, expect, it } from 'vitest'
import { changedDate } from '../src/lib/dates'

describe('changedDate', () => {
  it('sets one date, keeping each photo its time unless a time is given', () => {
    expect(changedDate('2020-05-03T08:15:42', { kind: 'set', date: '2019-07-14', time: null })).toBe('2019-07-14T08:15:42')
    expect(changedDate('2020-05-03T08:15:42', { kind: 'set', date: '2019-07-14', time: '10:30' })).toBe('2019-07-14T10:30:00')
    expect(changedDate('2020-05-03T08:15:42', { kind: 'set', date: '2019-02-31', time: null })).toBeNull()
    expect(changedDate('2020-05-03T08:15:42', { kind: 'set', date: '', time: null })).toBeNull()
  })

  it('shifts by years, days, hours and minutes, across months and years', () => {
    const shift = (years: number, days: number, hours: number, minutes = 0) => ({ kind: 'shift' as const, years, days, hours, minutes })
    expect(changedDate('2019-12-31T23:30:00', shift(1, 0, 0))).toBe('2020-12-31T23:30:00')
    expect(changedDate('2019-12-31T23:30:00', shift(0, 0, 1))).toBe('2020-01-01T00:30:00')
    expect(changedDate('2020-03-01T01:00:00', shift(0, -1, -2))).toBe('2020-02-28T23:00:00')
    expect(changedDate('2020-02-29T10:00:00', shift(1, 0, 0))).toBe('2021-02-28T10:00:00')
    expect(changedDate('2020-02-29T10:00:00', shift(-1, 0, 0, 45))).toBe('2019-02-28T10:45:00')
  })

  it('reads a date without seconds or time', () => {
    expect(changedDate('2020-05-03', { kind: 'shift', years: 0, days: 1, hours: 0, minutes: 0 })).toBe('2020-05-04T12:00:00')
    expect(changedDate('2020-05-03T08:15', { kind: 'set', date: '2021-01-01', time: null })).toBe('2021-01-01T08:15:00')
  })
})
