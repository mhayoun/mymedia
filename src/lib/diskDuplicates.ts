// "Disk duplicates" (from Tree suggestion): the photos and videos of the folder read that are there twice or
// more, the same content under other names ("IMG_0093.jpg" = "Picture 053.jpg"). Only the files of the same
// size are opened (to compare their content), so a big folder is checked quickly. Pure, tested.
import { albumOf, type WalkedFile } from './importPlan'

/** The files worth opening: those whose size another file of the folder has too. */
export function sameSizeFiles(files: WalkedFile[]): WalkedFile[] {
  const bySize = new Map<number, WalkedFile[]>()
  for (const f of files) if (f.size > 0) (bySize.get(f.size) ?? bySize.set(f.size, []).get(f.size)!).push(f)
  return [...bySize.values()].filter((g) => g.length > 1).flat()
}

export interface DiskCopy {
  file: WalkedFile
  /** The file's date on the disk (ms). */
  modified: number
  /** Its name and size are those of a file in MyMedia (the copy MyMedia knows, kept by default). */
  inMyMedia: boolean
}

export interface DuplicateGroup {
  key: string
  size: number
  /** The copy kept by default first, then the others. */
  copies: DiskCopy[]
  /** Copies in different albums (shown, as a photo may be in two albums on purpose). */
  acrossAlbums: boolean
}

/** A name a copy got ("IMG_0147 (1).jpg", "photo - Copie.jpg", "photo copy 2.jpg"). */
const COPY_NAME = /(\(\d+\)|[\s_-]+(copie|copy|kopie|copia)(\s*\(?\d+\)?)?)\s*$/i
/** The name a camera or a phone gives ("IMG_0093", "MVI_0236", "DSC01234", "PXL_20230101_…", "20130225_154846"), not one made again ("Picture 131"). */
const CAMERA_NAME = /^(_?(IMG|MVI|DSC[NF]?|PICT|CIMG|IMGP|SAM|GOPR|G[HX]\d\d|PXL|VID|WP|DJI|P\d{3}|MOV|HPIM|SDC|DCP|PANA)[_-]?\d|\d{8}[_-]\d{6})/i
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * Which copy stays by default: the one MyMedia already has; else the original, that is not a name of a copy
 * ("(1)", "Copie"), then the camera's name ("MVI_0236" rather than "Picture 131"), then the first on the disk.
 */
function keepFirst(a: DiskCopy, b: DiskCopy): number {
  if (a.inMyMedia !== b.inMyMedia) return a.inMyMedia ? -1 : 1
  const ca = COPY_NAME.test(stem(a.file.name))
  const cb = COPY_NAME.test(stem(b.file.name))
  if (ca !== cb) return ca ? 1 : -1
  const ka = CAMERA_NAME.test(a.file.name)
  const kb = CAMERA_NAME.test(b.file.name)
  if (ka !== kb) return ka ? -1 : 1
  if (a.modified !== b.modified) return a.modified - b.modified
  const pa = [...a.file.dirs, a.file.name].join('/')
  const pb = [...b.file.dirs, b.file.name].join('/')
  return pa.length - pb.length || pa.localeCompare(pb)
}

/** The files of the same content (`hash`), two or more, grouped; the biggest groups (in bytes saved) first. */
export function duplicateGroups(copies: (DiskCopy & { hash: string })[]): DuplicateGroup[] {
  const byHash = new Map<string, (DiskCopy & { hash: string })[]>()
  for (const c of copies) (byHash.get(c.hash) ?? byHash.set(c.hash, []).get(c.hash)!).push(c)
  const out: DuplicateGroup[] = []
  for (const [hash, list] of byHash) {
    if (list.length < 2) continue
    const albums = new Set(list.map((c) => albumOf(c.file.dirs)?.name ?? ''))
    out.push({
      key: hash,
      size: list[0].file.size,
      copies: list.map(({ hash: _, ...c }) => c).sort(keepFirst),
      acrossAlbums: albums.size > 1,
    })
  }
  return out.sort((x, y) => y.size * (y.copies.length - 1) - x.size * (x.copies.length - 1))
}

/** A file's place in the folder read, as a key ("2013/neige/IMG_0093.jpg"). */
export const pathKey = (f: Pick<WalkedFile, 'dirs' | 'name'>) => [...f.dirs, f.name].join('/')

/** The copies ticked to delete by default: every copy but the one kept (MyMedia's, else the original). */
export function defaultTicks(groups: DuplicateGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => g.copies.slice(1).map((c) => pathKey(c.file))))
}

export interface FolderPair {
  key: string
  /** The two folders (from the folder read, not included), in the order of their paths. */
  a: string[]
  b: string[]
  /** Its duplicates: each one copy in `a` and one in `b`. */
  groups: DuplicateGroup[]
  /** The bytes deleted by keeping one folder. */
  bytes: number
  /** The folder holding most of the copies kept by default (MyMedia's, else the originals). */
  usual: 'a' | 'b'
}

const dirKey = (dirs: string[]) => dirs.join('/')

/**
 * The duplicates that are exactly once in each of two folders, gathered by those two folders ("2010/Ski" and
 * "2010/Ski copie"): for them, choosing the folder to keep is enough. The others are not in it. Most bytes first.
 */
export function folderPairs(groups: DuplicateGroup[]): FolderPair[] {
  const pairs = new Map<string, FolderPair & { keptInA: number }>()
  for (const g of groups) {
    if (g.copies.length !== 2) continue
    const [x, y] = g.copies.map((c) => dirKey(c.file.dirs))
    if (x === y) continue
    const [ka, kb] = x < y ? [x, y] : [y, x]
    const key = `${ka}\n${kb}`
    let p = pairs.get(key)
    if (!p) {
      const a = g.copies.find((c) => dirKey(c.file.dirs) === ka)!.file.dirs
      const b = g.copies.find((c) => dirKey(c.file.dirs) === kb)!.file.dirs
      pairs.set(key, (p = { key, a, b, groups: [], bytes: 0, usual: 'a', keptInA: 0 }))
    }
    p.groups.push(g)
    p.bytes += g.size
    if (dirKey(g.copies[0].file.dirs) === ka) p.keptInA++
  }
  return [...pairs.values()]
    .map(({ keptInA, ...p }) => ({ ...p, usual: keptInA * 2 >= p.groups.length ? ('a' as const) : ('b' as const) }))
    .sort((x, y) => y.bytes - x.bytes || x.key.localeCompare(y.key))
}

/** The copies to delete to keep a pair's photos in one of its folders (those in the other one). */
export function pairTicks(pair: FolderPair, keep: 'a' | 'b'): string[] {
  const gone = dirKey(keep === 'a' ? pair.b : pair.a)
  return pair.groups.flatMap((g) => g.copies.filter((c) => dirKey(c.file.dirs) === gone).map((c) => pathKey(c.file)))
}
