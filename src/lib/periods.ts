// Years and months of the media (date taken), for the "Dates" menu and the
// gallery grouped by year or month (pure, tested).

/** "2024" or "2024-03"; null when the date is not readable. */
export function periodOf(takenAt: string | undefined, by: 'year' | 'month'): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(takenAt ?? '')
  if (!m) return null
  return by === 'year' ? m[1] : `${m[1]}-${m[2]}`
}

/** True when the media was taken in the period ("2024" or "2024-03"). */
export function inPeriod(takenAt: string | undefined, period: string): boolean {
  return periodOf(takenAt, period.length === 4 ? 'year' : 'month') === period
}

export interface YearEntry {
  year: string
  count: number
  /** Newest first. */
  months: { key: string; count: number }[]
}

/** The years and their months, newest first, with how many media in each. */
export function buildPeriods(dates: (string | undefined)[]): YearEntry[] {
  const years = new Map<string, Map<string, number>>()
  for (const d of dates) {
    const month = periodOf(d, 'month')
    if (!month) continue
    const year = month.slice(0, 4)
    let months = years.get(year)
    if (!months) years.set(year, (months = new Map()))
    months.set(month, (months.get(month) ?? 0) + 1)
  }
  return [...years.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, months]) => ({
      year,
      count: [...months.values()].reduce((n, c) => n + c, 0),
      months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, count]) => ({ key, count })),
    }))
}

/** "2024" as is; "2024-03" as "March 2024" in the language shown. */
export function periodLabel(period: string, locale: string): string {
  if (period.length === 4) return period
  const [y, m] = period.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1))
}
