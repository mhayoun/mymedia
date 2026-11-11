// "Tree suggestion": the folder chosen is walked by MyMedia itself (Chrome / Edge on a computer): the names of
// its folders and sub-folders, and of the photos and videos in them, nothing opened. The files are only read
// (as File) if the user then imports them.
import { mediaTypeOf } from '../lib/media'

interface FsHandle {
  kind: 'file' | 'directory'
  name: string
}
interface FsFile extends FsHandle {
  kind: 'file'
  getFile(): Promise<File>
}
interface FsDir extends FsHandle {
  kind: 'directory'
  values(): AsyncIterable<FsFile | FsDir>
}

export interface WalkedFolder {
  name: string
  /** Every folder below it, as paths ("anniv papa", "EinGuedi2015/873NIKON"). */
  dirs: string[][]
  /** Its photos and videos: path from the chosen folder (included), and how to read them. */
  files: { path: string; handle: FsFile }[]
}

/** Folders a disk or a system puts everywhere, not photos. */
const SKIPPED = /^(\.|\$RECYCLE\.BIN$|System Volume Information$|@eaDir$|__MACOSX$)/i

export function canWalkFolders(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window && !/Android|iPhone|iPad/i.test(navigator.userAgent)
}

/** The window to choose a folder, then its whole tree read (names only); null when the window is closed. */
export async function pickAndWalk(onCount: (dirs: number, files: number) => void): Promise<WalkedFolder | null> {
  let root: FsDir
  try {
    root = await (window as unknown as { showDirectoryPicker(o?: { mode?: 'read'; id?: string }): Promise<FsDir> }).showDirectoryPicker({ mode: 'read', id: 'mymedia-tree' })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
  const out: WalkedFolder = { name: root.name, dirs: [], files: [] }
  let last = 0
  const walk = async (dir: FsDir, path: string[]) => {
    for await (const h of dir.values()) {
      if (SKIPPED.test(h.name)) continue
      if (h.kind === 'directory') {
        out.dirs.push([...path, h.name])
        await walk(h, [...path, h.name])
      } else if (mediaTypeOf('', h.name)) out.files.push({ path: [root.name, ...path, h.name].join('/'), handle: h })
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

/** The photos and videos as files to import (each knowing its folder, like a folder chosen for an import). */
export async function filesOf(folder: WalkedFolder, onProgress: (done: number) => void): Promise<File[]> {
  const files: File[] = []
  for (const f of folder.files) {
    const file = await f.handle.getFile()
    Object.defineProperty(file, 'webkitRelativePath', { value: f.path })
    files.push(file)
    if (files.length % 200 === 0) onProgress(files.length)
  }
  onProgress(files.length)
  return files
}
