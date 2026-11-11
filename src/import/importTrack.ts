// A folder analysed in "Tree suggestion" and imported album by album, remembered on this device (this
// account's database) with the folder's access, the categories corrected by hand and the albums imported,
// so it goes on another day (analysed again: only what is left). Also what imports measured here
// (bytes read, bytes sent, time) to estimate the Drive space and time of the next ones.
import { useEffect, useSyncExternalStore } from 'react'
import { db } from '../db/db'
import type { ImportStats } from '../lib/importPlan'
import type { CategoryChoice } from '../ui/CategoryProposal'
import type { FsDir } from './folderWalk'

/** An album of the folder imported (by its name in MyMedia), and into which category. */
export interface ImportedAlbum {
  files: number
  failed: number
  category: string | null
  at: string
}

export interface ImportTrack {
  rootName: string
  handle: FsDir
  analysedAt: string
  /** Albums found at the last analysis. */
  albums: number
  /** The categories as corrected by hand (kept from one analysis to the next). */
  choice: CategoryChoice
  imported: Record<string, ImportedAlbum>
}

const KEY = 'importTrack'
let track: ImportTrack | null | undefined
/** The database it was read from (another account: its own import). */
let readFrom = ''
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((cb) => cb())

async function load() {
  const name = db().name
  if (track !== undefined && readFrom === name) return
  readFrom = name
  try {
    track = (await db().getKv<ImportTrack>(KEY)) ?? null
  } catch {
    track = null
  }
  emit()
}

/** The import followed on this device (null: none; undefined: not read yet). */
export function useImportTrack(): ImportTrack | null | undefined {
  useEffect(() => void load(), [])
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => track,
  )
}

export async function saveTrack(t: ImportTrack | null): Promise<void> {
  track = t
  emit()
  await db().setKv(KEY, t)
}

/** After an album's import: how many of its files are in MyMedia, how many failed, in which category. */
export async function markAlbum(name: string, files: number, failed: number, category: string | null): Promise<void> {
  if (track === undefined) await load()
  if (!track) return
  await saveTrack({ ...track, imported: { ...track.imported, [name]: { files, failed, category, at: new Date().toISOString() } } })
}

/** The last analysis of the followed folder, kept while MyMedia is open (reading 268 000 files again takes minutes). */
let lastAnalysis: unknown = null
export function keepAnalysis<T>(a: T) {
  lastAnalysis = a
}
export function keptAnalysis<T>(): T | null {
  return lastAnalysis as T | null
}

const STATS_KEY = 'mymedia.importStats'

export function importStats(): ImportStats | null {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null') as ImportStats | null
  } catch {
    return null
  }
}

/** Adds an import's numbers (bytes read, bytes sent, time) to what this device measured. */
export function recordImport(before: number, after: number, ms: number) {
  if (before <= 0 || ms <= 0) return
  const s = importStats() ?? { before: 0, after: 0, ms: 0 }
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify({ before: s.before + before, after: s.after + after, ms: s.ms + ms }))
  } catch {
    // An estimate less precise, nothing more.
  }
}
