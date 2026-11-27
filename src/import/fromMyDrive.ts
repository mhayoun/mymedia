// Import → "From Google Drive" → "My photos in Google Drive": photos and videos of the user's own Drive, chosen
// in Google's window (works with MyMedia Free). In order, each step only for what the one before succeeded:
//   1. optional (ticked by default), on a computer: their originals saved on the computer's disk, each one
//      read again there and checked against Google's fingerprint (MD5);
//   2. moved into an album of MyMedia (the same file: no copy, no place used), with their date;
//   3. optional (ticked by default): compressed; the old version of those saved on the disk is not kept by
//      Drive, so their place is freed at once.

import { db } from '../db/db'
import { adoptFile, downloadBlob, ensureFolderPath, getFile, type DriveFile } from '../drive/api'
import type { Picked } from '../drive/picker'
import { detectOrigin, localIso, mediaTypeOf } from '../lib/media'
import { syncNow, toRecord } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'
import { takenAtOf, type DriveEntry } from './fromDrive'
import type { FsDir } from './folderWalk'
import { md5Of } from './importer'

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

/* The part of the File System Access API used to write (Chrome / Edge on a computer). */
interface WFile {
  getFile(): Promise<File>
  createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>
}
interface WDir {
  name: string
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<WDir>
  getFileHandle(name: string, o?: { create?: boolean }): Promise<WFile>
}

/** A name Windows and the disks accept (no \ / : * ? " < > |, no dot or space at the end). */
export function diskName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim()
  return clean || '_'
}

/** "DSC_1.jpg" → "DSC_1 (2).jpg". */
export function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

export type SaveOutcome = { status: 'saved' | 'already'; path: string } | { status: 'mismatch' | 'error'; path?: string; reason?: string }

async function existing(dir: WDir, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

/**
 * Saves one original into `dirName` of the folder chosen on the disk, then reads it again there and checks
 * its fingerprint against Google's. A file already there with the same fingerprint is kept (export started
 * again); another file of the same name gets " (2)".
 */
export async function saveOriginal(root: FsDir, dirName: string, file: DriveFile, signal: AbortSignal): Promise<SaveOutcome> {
  const want = file.md5Checksum
  let dir: WDir
  try {
    dir = await (root as unknown as WDir).getDirectoryHandle(diskName(dirName), { create: true })
  } catch (e) {
    return { status: 'error', reason: (e as Error).message }
  }
  const base = diskName(file.name)
  let name = base
  for (let n = 2; ; n++) {
    const there = await existing(dir, name)
    if (!there) break
    if (want && there.size === Number(file.size) && (await md5Of(there)) === want) return { status: 'already', path: `${dir.name}/${name}` }
    name = numbered(base, n)
  }
  const path = `${dir.name}/${name}`
  try {
    const blob = await downloadBlob(file.id, undefined, signal)
    const handle = await dir.getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    try {
      await w.write(blob)
      await w.close()
    } catch (e) {
      await w.abort?.().catch(() => undefined)
      throw e
    }
    // Read again from the disk: what is there, not what was sent.
    const back = await handle.getFile()
    if (!want) return back.size === blob.size ? { status: 'saved', path } : { status: 'mismatch', path }
    return (await md5Of(back)) === want ? { status: 'saved', path } : { status: 'mismatch', path }
  } catch (e) {
    if (signal.aborted) throw e
    return { status: 'error', path, reason: (e as Error).message }
  }
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
