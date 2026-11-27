// "Save to the disk" (Chrome / Edge on a computer): photos and videos of Google Drive (chosen in Google's
// window) or of MyMedia (an album, a category, a selection) written into a folder of the computer's disk, one
// sub-folder per album, each read again there and checked against its fingerprint (MD5). For a photo MyMedia
// compressed, its original while Drive still keeps it (an older version), else the compressed one, told.
// The fingerprints checked are remembered on this device: "My photos in Google Drive" then lets Drive drop the
// old version of those it compresses (their original is safe on the disk), so their place is freed at once.

import { db, type MediaRecord } from '../db/db'
import { downloadBlob, downloadRevisionBlob, listRevisions, type DriveFile } from '../drive/api'
import { localIso } from '../lib/media'
import { placementOf, type FolderNode } from '../lib/tree'
import type { FsDir } from './folderWalk'
import { md5Of } from './importer'

/** One file to save: where on the disk, and how to get its content. */
export interface BackupItem {
  /** Unique in the list (the Drive file's id). */
  id: string
  name: string
  /** Its folders on the disk, below the folder chosen ("Birds", "Hoopoe"). */
  dir: string[]
  /** Its fingerprint when known before reading it (to find it already on the disk). */
  md5?: string
  size?: number
  /** Its content: the original when there is one; `current` when only a compressed version was left. */
  load(signal: AbortSignal): Promise<{ blob: Blob; md5?: string; current?: boolean }>
}

export type SaveOutcome =
  | { status: 'saved' | 'already'; path: string; md5?: string; current?: boolean }
  | { status: 'mismatch' | 'error'; path?: string; reason?: string }

/* The part of the File System Access API used to write. */
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
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim()
  return clean || '_'
}

/** "DSC_1.jpg" → "DSC_1 (2).jpg". */
export function numbered(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

async function existing(dir: WDir, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile()
  } catch {
    return null
  }
}

/**
 * Saves one file below the folder chosen, then reads it again there and checks its fingerprint. A file already
 * there with the same fingerprint is kept (a backup started again); another file of the same name gets " (2)".
 */
export async function saveItem(root: FsDir, item: BackupItem, signal: AbortSignal): Promise<SaveOutcome> {
  let dir = root as unknown as WDir
  const names = [dir.name]
  try {
    for (const d of item.dir) {
      dir = await dir.getDirectoryHandle(diskName(d), { create: true })
      names.push(dir.name)
    }
  } catch (e) {
    return { status: 'error', reason: (e as Error).message }
  }
  const base = diskName(item.name)
  let name = base
  for (let n = 2; ; n++) {
    const there = await existing(dir, name)
    if (!there) break
    if (item.md5 && (!item.size || there.size === item.size) && (await md5Of(there)) === item.md5)
      return { status: 'already', path: [...names, name].join('/'), md5: item.md5 }
    name = numbered(base, n)
  }
  const path = [...names, name].join('/')
  try {
    const { blob, md5, current } = await item.load(signal)
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
    const got = await md5Of(back)
    const want = md5 ?? (await md5Of(blob))
    return got === want ? { status: 'saved', path, md5: want, current } : { status: 'mismatch', path }
  } catch (e) {
    if (signal.aborted) throw e
    return { status: 'error', path, reason: (e as Error).message }
  }
}

/** Photos of Google Drive (chosen in Google's window), each group in its folder on the disk. */
export function driveItems(groups: { album: string; folderName: string | null; files: DriveFile[] }[]): BackupItem[] {
  return groups.flatMap((g) => {
    const dir = [g.album.trim() || g.folderName || 'Google Drive']
    return g.files.map((f) => ({
      id: f.id,
      name: f.name,
      dir,
      md5: f.md5Checksum,
      size: f.size ? Number(f.size) : undefined,
      load: async (signal: AbortSignal) => ({ blob: await downloadBlob(f.id, undefined, signal), md5: f.md5Checksum }),
    }))
  })
}

/**
 * Media of MyMedia, each in its category / album on the disk. A compressed one: its original while Drive keeps
 * it (the older version of the original size), else its compressed version (`current`).
 */
export function libraryItems(recs: MediaRecord[], folders: ReadonlyMap<string, FolderNode>, rootId: string): BackupItem[] {
  return recs.map((rec) => {
    const p = placementOf(rec.folderId, folders, rootId)
    const dir = [p.category, ...(p.album?.split(' / ') ?? [])].filter((x): x is string => !!x)
    const compressed = !!rec.appProperties?.mymedia_compressed
    const originalSize = Number(rec.appProperties?.mymedia_original_size) || 0
    const originalMd5 = rec.appProperties?.mymedia_source_md5 ?? undefined
    return {
      id: rec.id,
      name: rec.name,
      dir,
      md5: compressed ? originalMd5 : rec.md5,
      size: compressed ? originalSize || undefined : rec.size,
      load: async (signal: AbortSignal) => {
        if (compressed) {
          const older = (await listRevisions(rec.id).catch(() => []))
            .sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime))
            .slice(0, -1)
            .reverse()
          const original = older.find((r) => originalSize && Number(r.size) === originalSize) ?? older[0]
          if (original) {
            const blob = await downloadRevisionBlob(rec.id, original.id, signal)
            return { blob, md5: originalMd5 && blob.size === originalSize ? originalMd5 : undefined }
          }
          return { blob: await downloadBlob(rec.id, undefined, signal), md5: rec.md5, current: true }
        }
        return { blob: await downloadBlob(rec.id, undefined, signal), md5: rec.md5 }
      },
    }
  })
}

const KEY = 'diskBackups'
export interface Backup {
  /** Day it was saved and checked. */
  on: string
  /** Where on the disk ("Backup/Birds/DSC_1.jpg"). */
  path: string
}

/** The fingerprints saved and checked on the disk from this device. */
async function all(): Promise<Record<string, Backup>> {
  return (await db().getKv<Record<string, Backup>>(KEY)) ?? {}
}

export async function recordBackups(list: { md5: string; path: string }[]): Promise<void> {
  if (!list.length) return
  const cur = await all()
  const on = localIso(new Date()).slice(0, 10)
  for (const b of list) cur[b.md5] = { on, path: b.path }
  await db().setKv(KEY, cur)
}

/** Of these fingerprints, those saved and checked on the disk (from this device). */
export async function backupsOf(md5s: (string | undefined)[]): Promise<Map<string, Backup>> {
  const cur = await all()
  const out = new Map<string, Backup>()
  for (const m of md5s) if (m && cur[m]) out.set(m, cur[m])
  return out
}
