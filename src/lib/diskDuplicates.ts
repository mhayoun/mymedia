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
  /** Copies in different albums: none is ticked to delete by default (a photo may be in two albums on purpose). */
  acrossAlbums: boolean
}

/** A name a copy got ("IMG_0147 (1).jpg", "photo - Copie.jpg", "photo copy 2.jpg"). */
const COPY_NAME = /(\(\d+\)|[\s_-]+(copie|copy|kopie|copia)(\s*\(?\d+\)?)?)\s*$/i
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

/** Which copy stays by default: the one MyMedia knows, then the oldest, then a name without "(1)"/"Copie", then the shortest path. */
function keepFirst(a: DiskCopy, b: DiskCopy): number {
  if (a.inMyMedia !== b.inMyMedia) return a.inMyMedia ? -1 : 1
  if (a.modified !== b.modified) return a.modified - b.modified
  const ca = COPY_NAME.test(stem(a.file.name))
  const cb = COPY_NAME.test(stem(b.file.name))
  if (ca !== cb) return ca ? 1 : -1
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
  return out.sort((x, y) => Number(x.acrossAlbums) - Number(y.acrossAlbums) || y.size * (y.copies.length - 1) - x.size * (x.copies.length - 1))
}

/** A file's place in the folder read, as a key ("2013/neige/IMG_0093.jpg"). */
export const pathKey = (f: Pick<WalkedFile, 'dirs' | 'name'>) => [...f.dirs, f.name].join('/')

/** The copies ticked to delete by default: every copy but the first, in the groups of one album. */
export function defaultTicks(groups: DuplicateGroup[]): Set<string> {
  return new Set(groups.filter((g) => !g.acrossAlbums).flatMap((g) => g.copies.slice(1).map((c) => pathKey(c.file))))
}
