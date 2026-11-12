// The year at the start of an album's name ("TyoulJerusalem2015" → "2015 TyoulJerusalem"), so that the
// albums of a category are in the order of the years. A year is 4 digits from 1980 to this year, alone
// (not part of a longer number). Without one in the name, the year of most of the album's photos. Pure, tested.

const FIRST = 1980
const YEAR = /(?<!\d)(19\d\d|20\d\d)(?!\d)/g

const isYear = (y: number, now: number) => y >= FIRST && y <= now

/** The name with its year first: unchanged when it starts with one; `year` when it has none (null: unchanged). */
export function yearFirst(name: string, year: number | null = null, now = new Date().getFullYear()): string {
  const trimmed = name.trim()
  const first = /^(\d{4})(?!\d)/.exec(trimmed)
  if (first && isYear(Number(first[1]), now)) return trimmed
  for (const m of trimmed.matchAll(YEAR)) {
    if (!isYear(Number(m[1]), now)) continue
    const rest = (trimmed.slice(0, m.index) + ' ' + trimmed.slice(m.index! + 4))
      // The separators left around the year taken out.
      .replace(/\s*[_\-.,]*\s+[_\-.,]*\s*/g, ' ')
      .replace(/^[\s_\-.,]+|[\s_\-.,]+$/g, '')
    return rest ? `${m[1]} ${rest}` : m[1]
  }
  return year !== null && isYear(year, now) ? `${year} ${trimmed}` : trimmed
}

/** Whether the name gives its year itself (at the start or inside). */
export function nameHasYear(name: string, now = new Date().getFullYear()): boolean {
  return [...name.matchAll(YEAR)].some((m) => isYear(Number(m[1]), now))
}

/** The year most of these dates are in (the earliest of equals); null without any. */
export function mostYear(dates: string[]): number | null {
  const counts = new Map<number, number>()
  for (const d of dates) {
    const y = Number(d.slice(0, 4))
    if (Number.isFinite(y) && y > 0) counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [y, n] of counts) if (best === null || n > counts.get(best)! || (n === counts.get(best)! && y < best)) best = y
  return best
}
