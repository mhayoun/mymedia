// "Disk years" (from Tree suggestion, once a folder of the computer is read): the photos and videos of the
// folders named with their year first ("2015_Ski", "2015 Ski", "2015-Ski") whose own date is of another
// year. Pure, tested.

import type { WalkedFile } from './importPlan'

const FIRST = 1980
/** A year at the very start of a name, alone (not the start of a longer number). */
const LEADING = /^(19\d\d|20\d\d)(?!\d)/

/** The year a folder's name starts with, or null. */
export function leadingYear(name: string, now = new Date().getFullYear()): number | null {
  const m = LEADING.exec(name.trim())
  const y = m ? Number(m[1]) : NaN
  return y >= FIRST && y <= now ? y : null
}

/**
 * The folder that gives a file its year: the nearest one above it whose name starts with a year
 * ("2015_Ski / Day 1 / IMG.jpg" → "2015_Ski", 2015). Null when no folder of its path has one.
 */
export function folderYearOf(dirs: string[], now = new Date().getFullYear()): { dirs: string[]; year: number } | null {
  for (let i = dirs.length - 1; i >= 0; i--) {
    const year = leadingYear(dirs[i], now)
    if (year !== null) return { dirs: dirs.slice(0, i + 1), year }
  }
  return null
}

/** The photos and videos that have a folder with a year (documents left out). */
export function filesWithYear(files: WalkedFile[], now = new Date().getFullYear()): { file: WalkedFile; folder: string[]; year: number }[] {
  return files.flatMap((file) => {
    if (file.type === 'document') return []
    const f = folderYearOf(file.dirs, now)
    return f ? [{ file, folder: f.dirs, year: f.year }] : []
  })
}

export interface DatedFile {
  file: WalkedFile
  /** Local date-time "YYYY-MM-DDTHH:mm:ss". */
  takenAt: string
  /** Where the date comes from: only 'file' (modification date) is not the day it was taken. */
  source: string
}

export interface YearFolder {
  /** The folder with the year, from the folder read (not included). */
  dirs: string[]
  year: number
  /** Its photos and videos checked. */
  checked: number
  /** Those of another year, the earliest first. */
  wrong: DatedFile[]
  /** Those without a date of their own (only the modification date of the file), not counted as wrong. */
  undated: DatedFile[]
}

const folderKey = (dirs: string[]) => dirs.join('/')

/** The folders with a year, each with its files of another year; folders with nothing wrong are kept (checked). */
export function yearFolders(items: (DatedFile & { folder: string[]; year: number })[]): YearFolder[] {
  const byFolder = new Map<string, YearFolder>()
  for (const it of items) {
    const key = folderKey(it.folder)
    let f = byFolder.get(key)
    if (!f) byFolder.set(key, (f = { dirs: it.folder, year: it.year, checked: 0, wrong: [], undated: [] }))
    f.checked++
    const d: DatedFile = { file: it.file, takenAt: it.takenAt, source: it.source }
    if (it.source === 'file') f.undated.push(d)
    else if (Number(it.takenAt.slice(0, 4)) !== it.year) f.wrong.push(d)
  }
  const list = [...byFolder.values()]
  for (const f of list) f.wrong.sort((a, b) => a.takenAt.localeCompare(b.takenAt))
  return list.sort((a, b) => b.wrong.length - a.wrong.length || folderKey(a.dirs).localeCompare(folderKey(b.dirs)))
}

/** The year most of a folder's wrong files are in (to tell "the folder's name may be wrong"); null under half. */
export function likelyYear(f: YearFolder): number | null {
  const dated = f.checked - f.undated.length
  if (!dated || f.wrong.length * 2 <= dated) return null
  const counts = new Map<number, number>()
  for (const w of f.wrong) {
    const y = Number(w.takenAt.slice(0, 4))
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [y, n] of counts) if (best === null || n > counts.get(best)!) best = y
  return best
}
