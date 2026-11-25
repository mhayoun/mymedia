// "Disk years" (from Tree suggestion, once a folder of the computer is read): the photos and videos of the
// folders named with their year first ("2015_Ski", "2015 Ski", "2015-Ski") whose own date is of another
// year. Pure, tested.

import type { WalkedFile } from './importPlan'

const DAY = 24 * 3600 * 1000

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
  /** The file's modification date on the disk (ms): when a camera's file was copied from its card. */
  modified?: number
}

/**
 * A date of the camera itself (EXIF, video header) later than the file's copy on the disk: impossible, so the
 * camera's clock was wrong (a photo "of July 2009" copied from the card in August 2008). A day of margin.
 */
export function clockAhead(d: DatedFile): boolean {
  if ((d.source !== 'exif' && d.source !== 'video') || !d.modified) return false
  const taken = new Date(d.takenAt).getTime()
  return Number.isFinite(taken) && taken > d.modified + DAY
}

/**
 * A camera whose clock was never set (after its battery was changed, or new): it starts at its own "zero", the
 * 1st of January at midnight of a year of its own (1980, 2000…), and counts from there. A photo of a year before
 * the folder's, taken a 1st of January in its first hours. Its true day is known nowhere.
 */
export function clockUnset(d: DatedFile, year: number): boolean {
  if (d.source !== 'exif' && d.source !== 'video') return false
  const m = /^(\d{4})-01-01T(\d\d)/.exec(d.takenAt)
  return !!m && Number(m[1]) < year && Number(m[2]) < 6
}

/** Why a file is not of its folder's year: its camera's clock never set, ahead of its copy, or a true date. */
export type WrongWhy = 'unset' | 'ahead' | 'other'

export interface WrongFile extends DatedFile {
  why: WrongWhy
}

export interface YearFolder {
  /** The folder with the year, from the folder read (not included). */
  dirs: string[]
  year: number
  /** Its photos and videos checked. */
  checked: number
  /** Those of another year, the earliest first. */
  wrong: WrongFile[]
  /** Those without a date of their own (only the modification date of the file), not counted as wrong. */
  undated: DatedFile[]
  /** Of the wrong ones, those dated after their copy on the disk (camera clock wrong). */
  ahead: number
  /** Of the wrong ones, those of a camera whose clock was never set (1st of January 1980…). */
  unset: number
  /** The earliest modification date of those (ms), the day the card was copied; null without any. */
  copiedOn: number | null
}

const folderKey = (dirs: string[]) => dirs.join('/')

/** The folders with a year, each with its files of another year; folders with nothing wrong are kept (checked). */
export function yearFolders(items: (DatedFile & { folder: string[]; year: number })[]): YearFolder[] {
  const byFolder = new Map<string, YearFolder>()
  for (const it of items) {
    const key = folderKey(it.folder)
    let f = byFolder.get(key)
    if (!f) byFolder.set(key, (f = { dirs: it.folder, year: it.year, checked: 0, wrong: [], undated: [], ahead: 0, unset: 0, copiedOn: null }))
    f.checked++
    const d: DatedFile = { file: it.file, takenAt: it.takenAt, source: it.source, modified: it.modified }
    if (it.source === 'file') f.undated.push(d)
    else if (Number(it.takenAt.slice(0, 4)) !== it.year) {
      const why: WrongWhy = clockUnset(d, it.year) ? 'unset' : clockAhead(d) ? 'ahead' : 'other'
      f.wrong.push({ ...d, why })
      if (why === 'unset') f.unset++
      if (why === 'ahead') {
        f.ahead++
        f.copiedOn = f.copiedOn === null ? d.modified! : Math.min(f.copiedOn, d.modified!)
      }
    }
  }
  const list = [...byFolder.values()]
  for (const f of list) f.wrong.sort((a, b) => a.takenAt.localeCompare(b.takenAt))
  return list.sort((a, b) => b.wrong.length - a.wrong.length || folderKey(a.dirs).localeCompare(folderKey(b.dirs)))
}

/** Whether most of a folder's wrong files were dated by a camera whose clock was wrong. */
export const clockWrong = (f: YearFolder) => f.ahead > 0 && f.ahead * 2 >= f.wrong.length

/** Whether a wrong file's date is the camera's mistake (corrected to the folder's year), not a true date. */
export const clockMistake = (w: WrongFile) => w.why !== 'other'

/**
 * The year most of a folder's files of a true date are in (to tell "the folder's name may be wrong"); null under
 * half, and null when the camera's clock was wrong (the folder's name is then right). The camera's mistakes are
 * left out.
 */
export function likelyYear(f: YearFolder): number | null {
  if (clockWrong(f)) return null
  const others = f.wrong.filter((w) => !clockMistake(w))
  const dated = f.checked - f.undated.length - (f.wrong.length - others.length)
  if (!dated || others.length * 2 <= dated) return null
  const counts = new Map<number, number>()
  for (const w of others) {
    const y = Number(w.takenAt.slice(0, 4))
    counts.set(y, (counts.get(y) ?? 0) + 1)
  }
  let best: number | null = null
  for (const [y, n] of counts) if (best === null || n > counts.get(best)!) best = y
  return best
}

/** Years to add to a date to put it in `year` (same day and time): 2009-07-08 to 2008 → -1. */
export const yearsTo = (takenAt: string, year: number) => year - Number(takenAt.slice(0, 4))
