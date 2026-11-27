// Import → "From Google Drive" → "My photos in Google Drive": photos and videos of the user's own Drive, chosen
// in Google's window (works with MyMedia Free), moved into an album of MyMedia (the same file: no copy, no place
// used) with their date, then compressed (optional, ticked by default). Those saved on the disk before ("Save
// to the disk", import/diskBackup.ts) do not keep their old version in Drive: their place is freed at once.

import { db } from '../db/db'
import { adoptFile, ensureFolderPath, getFile, type DriveFile } from '../drive/api'
import type { Picked } from '../drive/picker'
import { detectOrigin, localIso, mediaTypeOf } from '../lib/media'
import { syncNow, toRecord } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'
import { takenAtOf, type DriveEntry } from './fromDrive'

const FIELDS = 'id,name,mimeType,size,md5Checksum,parents,createdTime,imageMediaMetadata(time),videoMediaMetadata(durationMillis)'

/** A group of files chosen together: those of one folder of Drive, put in one album. */
export interface PickedGroup {
  key: string
  /** The Drive folder they were in (its name when MyMedia may read it). */
  folderName: string | null
  files: DriveFile[]
}

/** The photos and videos chosen in Google's window, read again (size, fingerprint, date), by folder. */
export async function describePicked(picked: Picked[], onCount: (n: number) => void): Promise<{ groups: PickedGroup[]; unreadable: number }> {
  const byFolder = new Map<string, DriveFile[]>()
  let unreadable = 0
  let n = 0
  for (const p of picked) {
    try {
      const f = await getFile(p.id, FIELDS)
      if (!mediaTypeOf(f.mimeType, f.name)) continue
      const key = f.parents?.[0] ?? p.parentId ?? ''
      byFolder.set(key, [...(byFolder.get(key) ?? []), f])
    } catch (e) {
      console.warn('[MyMedia] chosen file unreadable', p.name, e)
      unreadable++
    }
    onCount(++n)
  }
  const groups: PickedGroup[] = []
  for (const [key, files] of byFolder) {
    // With MyMedia Free, Google gives the files chosen, not their folder: its name is then unknown.
    const folderName = key ? await getFile(key, 'id,name').then((f) => f.name, () => null) : null
    groups.push({ key, folderName, files })
  }
  return { groups, unreadable }
}

/**
 * Moves the files into MyMedia: each group into `destId` / its album name (directly into `destId` without a
 * name). Same file, no copy. Returns the ids moved.
 */
export async function moveIntoMyMedia(
  groups: { album: string; files: DriveFile[] }[],
  destId: string,
  onProgress: (done: number, failed: number) => void,
  signal: AbortSignal,
): Promise<{ moved: string[]; failed: number; reason?: string; albums: { name: string; id: string; count: number }[] }> {
  const d = db()
  const on = localIso(new Date()).slice(0, 10)
  const moved: string[] = []
  let failed = 0
  let reason: string | undefined
  const albums: { name: string; id: string; count: number }[] = []
  try {
    for (const g of groups) {
      if (signal.aborted) break
      const album = g.album.trim()
      const to = album ? await ensureFolderPath(destId, [album]) : destId
      const place = { name: album, id: to, count: 0 }
      albums.push(place)
      for (const file of g.files) {
        if (signal.aborted) break
        try {
          const takenAt = takenAtOf(file)
          const f = await adoptFile(file.id, to, file.parents ?? [], {
            mymedia_taken: takenAt,
            ...(file.md5Checksum ? { mymedia_source_md5: file.md5Checksum } : {}),
          })
          const rec = toRecord(f)
          if (rec) {
            rec.takenAt = takenAt
            await d.media.put(rec)
            const detected = detectOrigin({ name: file.name, type: rec.type, folderPath: album })
            await d.meta.put({
              id: rec.id,
              name: rec.name,
              type: rec.type,
              takenAt,
              origin: detected === 'unknown' ? 'import' : detected,
              source: 'folder',
              imported: { from: 'Google Drive', on, ...(album ? { path: album } : {}) },
              updatedAt: Date.now(),
            })
          }
          moved.push(file.id)
          place.count++
        } catch (e) {
          console.error('[MyMedia] move into MyMedia failed', file.name, e)
          failed++
          reason ??= (e as Error).message
        }
        onProgress(moved.length, failed)
      }
    }
  } finally {
    if (moved.length) {
      await markMetaDirty()
      void syncNow()
    }
  }
  return { moved, failed, reason, albums: albums.filter((a) => a.count) }
}

/**
 * A name for an album from its photos' dates, when the folder's is unknown: "2025_08" (one month), "2025"
 * (one year), "2014-2016" (more years); empty without any file.
 */
export function nameFromDates(dates: string[]): string {
  const ok = dates.filter((d) => /^\d{4}-\d\d/.test(d))
  if (!ok.length) return ''
  const months = new Set(ok.map((d) => d.slice(0, 7)))
  if (months.size === 1) return ok[0].slice(0, 7).replace('-', '_')
  const years = [...new Set(ok.map((d) => d.slice(0, 4)))].sort()
  return years.length === 1 ? years[0] : `${years[0]}-${years[years.length - 1]}`
}

/** The groups as entries, to find those already in MyMedia (same fingerprint). */
export const entriesOf = (groups: PickedGroup[]): DriveEntry[] => groups.flatMap((g) => g.files.map((file) => ({ file, relDir: [], path: [] })))
