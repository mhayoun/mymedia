// Import from files another Google account shared with this one: Google
// copies them into MyMedia (nothing goes through this device), with their
// date, checked against what MyMedia already has.

import { db } from '../db/db'
import { childrenQuery, copyFile, ensureFolderPath, FILE_FIELDS, listFiles, type DriveFile } from '../drive/api'
import { dateFromFileName, detectOrigin, FOLDER_MIME, localIso, parseExifDate } from '../lib/media'
import { syncNow, toRecord } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'
import { knownFiles } from './importer'

const MEDIA = `(mimeType = '${FOLDER_MIME}' or mimeType contains 'image/' or mimeType contains 'video/')`
const FIELDS = 'id,name,mimeType,size,md5Checksum,createdTime,imageMediaMetadata(time),owners(emailAddress),ownedByMe'

export const isFolder = (f: DriveFile) => f.mimeType === FOLDER_MIME

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const sorted = (files: DriveFile[]) => files.sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || collator.compare(a.name, b.name))

/**
 * What other accounts shared with this one (`folderId` null), or what a
 * shared folder holds. Google's "Shared with me" leaves out items from someone
 * unknown until they are opened once: the files of other owners are asked
 * too, and only the top ones kept (not those inside a shared folder).
 */
export async function listShared(folderId: string | null): Promise<DriveFile[]> {
  if (folderId) {
    const out: DriveFile[] = []
    await listFiles(`${childrenQuery([folderId])} and ${MEDIA}`, (files) => void out.push(...files), undefined, FIELDS)
    return sorted(out)
  }
  const byId = new Map<string, DriveFile>()
  const add = (files: DriveFile[]) => files.forEach((f) => byId.set(f.id, f))
  await Promise.all([
    listFiles(`sharedWithMe = true and trashed = false and ${MEDIA}`, add, undefined, `${FIELDS},parents`),
    listFiles(`not 'me' in owners and trashed = false and ${MEDIA}`, add, undefined, `${FIELDS},parents`),
  ])
  return sorted(topShared([...byId.values()]))
}

/**
 * Items not inside another of the listed folders (a shared folder brings what
 * it holds). Items this account owns are left out: Google still says "shared
 * with me" of what was given to it by a transfer.
 */
export function topShared(files: DriveFile[]): DriveFile[] {
  const others = files.filter((f) => f.ownedByMe !== true)
  const folders = new Set(others.filter(isFolder).map((f) => f.id))
  return others.filter((f) => !f.parents?.some((p) => folders.has(p)))
}

export interface DriveEntry {
  file: DriveFile
  /** Folders between the chosen folder (included) and the file. */
  relDir: string[]
}

/** The photos and videos of the chosen files and folders (sub-folders included). */
export async function collect(chosen: DriveFile[], onCount: (n: number) => void): Promise<DriveEntry[]> {
  const out: DriveEntry[] = []
  const walk = async (f: DriveFile, dir: string[]) => {
    if (!isFolder(f)) {
      out.push({ file: f, relDir: dir })
      onCount(out.length)
      return
    }
    for (const c of await listShared(f.id)) await walk(c, [...dir, f.name])
  }
  for (const f of chosen) await walk(f, [])
  return out
}

/** Date of a Drive file: in the photo, else in its name, else when it was put in Drive. */
export function takenAtOf(f: DriveFile): string {
  return parseExifDate(f.imageMediaMetadata?.time) ?? dateFromFileName(f.name) ?? localIso(new Date(f.createdTime ?? Date.now()))
}

/** Entries already in MyMedia (same MD5) or twice in the choice. */
export async function markDuplicates(entries: DriveEntry[]): Promise<Set<string>> {
  const known = knownFiles(await db().media.toArray())
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const e of entries) {
    const md5 = e.file.md5Checksum
    if (md5 && (known.md5.has(md5) || seen.has(md5))) dup.add(e.file.id)
    if (md5) seen.add(md5)
  }
  return dup
}

let abort: AbortController | null = null
export const cancelDriveImport = () => abort?.abort()

/** Copies the entries into `destId` (sub-folders as albums when `keepFolders`). */
export async function importFromDrive(
  entries: DriveEntry[],
  destId: string,
  keepFolders: boolean,
  onProgress: (done: number, failed: number) => void,
): Promise<{ count: number; failed: number; reason?: string }> {
  abort = new AbortController()
  const signal = abort.signal
  const d = db()
  const folders = new Map<string, Promise<string>>()
  const folderFor = (dir: string[]) => {
    if (!keepFolders || !dir.length) return Promise.resolve(destId)
    const k = dir.join('/')
    if (!folders.has(k)) folders.set(k, ensureFolderPath(destId, dir))
    return folders.get(k)!
  }
  const on = localIso(new Date()).slice(0, 10)
  let count = 0
  let failed = 0
  let reason: string | undefined
  let next = 0
  const worker = async () => {
    while (next < entries.length && !signal.aborted) {
      const { file, relDir } = entries[next++]
      try {
        const takenAt = takenAtOf(file)
        const copy = await copyFile(
          file.id,
          file.name,
          await folderFor(relDir),
          { appProperties: { mymedia_taken: takenAt, ...(file.md5Checksum ? { mymedia_source_md5: file.md5Checksum } : {}) } },
          FILE_FIELDS,
        )
        const rec = toRecord(copy)
        if (rec) {
          rec.takenAt = takenAt
          await d.media.put(rec)
          const detected = detectOrigin({ name: file.name, type: rec.type, folderPath: relDir.join('/') })
          await d.meta.put({
            id: rec.id,
            name: rec.name,
            type: rec.type,
            takenAt,
            origin: detected === 'unknown' ? 'import' : detected,
            source: 'folder',
            imported: { from: file.owners?.[0]?.emailAddress ?? 'Google Drive', on, ...(relDir.length ? { path: relDir.join('/') } : {}) },
            updatedAt: Date.now(),
          })
        }
        count++
      } catch (e) {
        console.error('[MyMedia] Drive copy failed', file.name, e)
        failed++
        reason ??= (e as Error).message
      }
      onProgress(count, failed)
    }
  }
  try {
    // Copies are made by Google: a few at a time.
    await Promise.all(Array.from({ length: 4 }, worker))
  } finally {
    abort = null
    if (count) {
      await markMetaDirty()
      void syncNow()
    }
  }
  return { count, failed, reason }
}
