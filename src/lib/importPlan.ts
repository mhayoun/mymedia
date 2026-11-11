// A big folder imported album by album: each album of the folder (wherever it is below the containers),
// with its folders, files and sizes; and how much Google Drive space and time importing it takes. Pure, tested.
import { albumNameOf } from './cameraFolders'
import { isContainer } from './folderNames'

export interface WalkedFile {
  /** Folders from the chosen folder (not included) down to the file. */
  dirs: string[]
  name: string
  size: number
  type: 'photo' | 'video' | 'document'
}

export interface PlanAlbum {
  /** Its name in MyMedia ("anniv papa"; "Pourim5773" for "442___02Pourim5773"). */
  name: string
  /** The folders it comes from (the same name under My Pictures and My Pictures2005: one album). */
  dirs: string[][]
  files: number
  bytes: number
  photoBytes: number
  videoBytes: number
}

export interface Sizes {
  files: number
  bytes: number
  photoBytes: number
  videoBytes: number
}

/** The album a file's folders give: the first folder that is neither a container nor a camera folder. */
export function albumOf(dirs: string[]): { name: string; dir: string[] } | null {
  for (let k = 0; k < dirs.length; k++) {
    const name = albumNameOf(dirs[k])
    if (name !== null && !isContainer(dirs[k])) return { name, dir: dirs.slice(0, k + 1) }
  }
  return null
}

/** The albums of the files read, sorted by name; the files outside any album apart. */
export function planAlbums(files: WalkedFile[]): { albums: PlanAlbum[]; loose: Sizes } {
  const byName = new Map<string, PlanAlbum & { dirKeys: Set<string> }>()
  const loose: Sizes = { files: 0, bytes: 0, photoBytes: 0, videoBytes: 0 }
  for (const f of files) {
    const a = albumOf(f.dirs)
    const target = a
      ? (byName.get(a.name) ??
        byName.set(a.name, { name: a.name, dirs: [], dirKeys: new Set(), files: 0, bytes: 0, photoBytes: 0, videoBytes: 0 }).get(a.name)!)
      : loose
    if (a) {
      const album = target as PlanAlbum & { dirKeys: Set<string> }
      const key = a.dir.join('/')
      if (!album.dirKeys.has(key)) {
        album.dirKeys.add(key)
        album.dirs.push(a.dir)
      }
    }
    target.files++
    target.bytes += f.size
    if (f.type === 'photo') target.photoBytes += f.size
    if (f.type === 'video') target.videoBytes += f.size
  }
  const albums = [...byName.values()].map(({ dirKeys: _, ...a }) => a).sort((x, y) => x.name.localeCompare(y.name))
  return { albums, loose }
}

export function sumSizes(list: Sizes[]): Sizes {
  return list.reduce((s, a) => ({ files: s.files + a.files, bytes: s.bytes + a.bytes, photoBytes: s.photoBytes + a.photoBytes, videoBytes: s.videoBytes + a.videoBytes }), {
    files: 0,
    bytes: 0,
    photoBytes: 0,
    videoBytes: 0,
  })
}

/** What earlier imports showed on this device: bytes read and sent, and the time it took. */
export interface ImportStats {
  before: number
  after: number
  ms: number
}

/** Before any import: what MyMedia's compression usually leaves (photos from cameras, videos). */
const PHOTO_RATIO = 0.35
const VIDEO_RATIO = 0.3
/** Before any import: 10 Mbit/s sent, and the time to read and compress each file. */
const DEFAULT_UPLOAD = 10e6 / 8
const PER_FILE_MS = 400

/**
 * The space taken in Google Drive and the time to import, compressed or not. Measured on this device
 * once enough was imported (both stay estimates: some photos are already small, videos vary).
 */
export function estimateImport(s: Sizes, compress: boolean, stats?: ImportStats | null): { driveBytes: number; ms: number; measured: boolean } {
  const measured = !!stats && stats.before > 200e6 && stats.ms > 60_000
  const other = s.bytes - s.photoBytes - s.videoBytes
  const driveBytes = !compress
    ? s.bytes
    : measured
      ? Math.round(s.bytes * Math.min(1, stats!.after / stats!.before))
      : Math.round(s.photoBytes * PHOTO_RATIO + s.videoBytes * VIDEO_RATIO + other)
  const ms = measured ? (s.bytes / stats!.before) * stats!.ms : (driveBytes / DEFAULT_UPLOAD) * 1000 + s.files * PER_FILE_MS
  return { driveBytes, ms: Math.round(ms), measured }
}
