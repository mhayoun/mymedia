// "Tree suggestion": the folder chosen is walked by MyMedia itself (Chrome / Edge on a computer): the names of
// its folders and sub-folders, and the names and sizes of the photos and videos in them, nothing opened. The
// files are only read if the user then imports them. The folder's access can be kept on this device, so an
// import followed album by album goes on another day.
import { mediaTypeOf } from '../lib/media'
import type { WalkedFile } from '../lib/importPlan'

interface FsHandle {
  kind: 'file' | 'directory'
  name: string
}
interface FsFile extends FsHandle {
  kind: 'file'
  getFile(): Promise<File>
}
export interface FsDir extends FsHandle {
  kind: 'directory'
  values(): AsyncIterable<FsFile | FsDir>
  getDirectoryHandle(name: string): Promise<FsDir>
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>
  isSameEntry?(other: FsDir): Promise<boolean>
}

export interface WalkedFolder {
  name: string
  /** The folder itself, to read its files at import (and keep for later). */
  handle: FsDir
  /** Every folder below it, as paths ("anniv papa", "EinGuedi2015/873NIKON"). */
  dirs: string[][]
  /** Its photos and videos: folders, name, size, type. */
  files: WalkedFile[]
}

/** Folders a disk or a system puts everywhere, not photos. */
const SKIPPED = /^(\.|\$RECYCLE\.BIN$|System Volume Information$|@eaDir$|__MACOSX$)/i

export function canWalkFolders(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && !/Android|iPhone|iPad/i.test(navigator.userAgent)
}

/** The window to choose a folder, then its whole tree read (names and sizes only); null when the window is closed. */
export async function pickAndWalk(onCount: (dirs: number, files: number) => void): Promise<WalkedFolder | null> {
  let root: FsDir
  try {
    root = await (window as unknown as { showDirectoryPicker(o?: { mode?: 'read'; id?: string }): Promise<FsDir> }).showDirectoryPicker({ mode: 'read', id: 'mymedia-tree' })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
  return walkFolder(root, onCount)
}

/** A folder's whole tree read (names and sizes only): a folder just chosen, or the one kept from another day. */
export async function walkFolder(root: FsDir, onCount: (dirs: number, files: number) => void): Promise<WalkedFolder> {
  const out: WalkedFolder = { name: root.name, handle: root, dirs: [], files: [] }
  let last = 0
  const walk = async (dir: FsDir, path: string[]) => {
    for await (const h of dir.values()) {
      if (SKIPPED.test(h.name)) continue
      if (h.kind === 'directory') {
        out.dirs.push([...path, h.name])
        await walk(h, [...path, h.name])
      } else {
        const type = mediaTypeOf('', h.name)
        // The size only: the file is not read.
        if (type) out.files.push({ dirs: path, name: h.name, size: (await h.getFile().catch(() => null))?.size ?? 0, type })
      }
      if (Date.now() - last > 150) {
        last = Date.now()
        onCount(out.dirs.length, out.files.length)
      }
    }
  }
  await walk(root, [])
  onCount(out.dirs.length, out.files.length)
  return out
}

/** The access to a folder kept from another day: asked again (Chrome shows "Allow?") if needed. */
export async function canRead(root: FsDir): Promise<boolean> {
  if ((await root.queryPermission?.({ mode: 'read' })) === 'granted') return true
  return (await root.requestPermission?.({ mode: 'read' })) === 'granted'
}

/**
 * The photos and videos below some folders of `root`, as files to import, each knowing its folder from
 * `top` down ("anniv papa/sub/a.jpg"), like a folder chosen for an import.
 */
export async function filesBelow(root: FsDir, dirs: string[][], top: string, onCount: (n: number) => void): Promise<File[]> {
  const files: File[] = []
  const walk = async (dir: FsDir, rel: string[]) => {
    for await (const h of dir.values()) {
      if (SKIPPED.test(h.name)) continue
      if (h.kind === 'directory') await walk(h, [...rel, h.name])
      else if (mediaTypeOf('', h.name)) {
        const file = await h.getFile()
        Object.defineProperty(file, 'webkitRelativePath', { value: [top, ...rel, h.name].join('/') })
        files.push(file)
        if (files.length % 100 === 0) onCount(files.length)
      }
    }
  }
  for (const path of dirs) {
    let dir = root
    for (const name of path) dir = await dir.getDirectoryHandle(name)
    await walk(dir, [])
  }
  onCount(files.length)
  return files
}
