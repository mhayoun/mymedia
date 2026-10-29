// Changing the date of photos: one date for all, or a shift (camera clock
// wrong). Dates are local "YYYY-MM-DDTHH:mm:ss" (pure, tested).

import { localIso } from './media'

export type DateChange =
  | { kind: 'set'; /** "YYYY-MM-DD" */ date: string; /** "HH:mm"; null: each photo keeps its time. */ time: string | null }
  | { kind: 'shift'; years: number; days: number; hours: number; minutes: number }

/** A date as MyMedia keeps it ("YYYY-MM-DDTHH:mm:ss"), or an ISO date of Drive (with its zone), as a local Date. */
function toLocal(takenAt: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(takenAt)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 12), +(m[5] ?? 0), +(m[6] ?? 0))
  return new Date(takenAt)
}

/** The new date of a photo taken at `takenAt`; null when the change gives no valid date. */
export function changedDate(takenAt: string, change: DateChange): string | null {
  const d = toLocal(takenAt)
  if (change.kind === 'set') {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(change.date)
    if (!day) return null
    const time = change.time ? /^(\d{2}):(\d{2})$/.exec(change.time) : null
    if (change.time && !time) return null
    const out = new Date(+day[1], +day[2] - 1, +day[3], time ? +time[1] : d.getHours(), time ? +time[2] : d.getMinutes(), time ? 0 : d.getSeconds())
    // 31/02 and the like.
    if (out.getDate() !== +day[3] || Number.isNaN(out.getTime())) return null
    return localIso(out)
  }
  if (Number.isNaN(d.getTime())) return null
  // 29/02 + 1 year: 28/02, not 01/03.
  const day = d.getDate()
  d.setDate(1)
  d.setFullYear(d.getFullYear() + change.years)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  d.setDate(d.getDate() + change.days)
  d.setHours(d.getHours() + change.hours, d.getMinutes() + change.minutes)
  return localIso(d)
}
