// The albums a chosen folder gives, from the names of its folders and sub-folders only (no photo opened):
// from the files of a folder chosen on the computer, and the tree as text (like what
// the "tree" command prints, for the tree shown). Camera folders (DCIM, 100NIKON…) left out, like at import. Pure, tested.
import { albumPath } from './cameraFolders'
import { wordsOf } from './proposeCategories'

export interface FolderName {
  name: string
  /** Files it holds (from a folder chosen), or its sub-folders (from a pasted list). */
  count: number
}

function sorted(counts: Map<string, number>): FolderName[] {
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Folders that only hold others ("My Pictures2004", "photos", "myBackup", "2015"): MyMedia looks inside them. */
const CONTAINER = /^(?:(?:my|mes|mon) )?(?:pictures?|photos?|images?|videos?|vid[eé]os|backups?|sauvegardes?|dropbox|onedrive|takeout|google photos|camera roll|pellicule|תמונות|גיבוי)(?: \d{1,4})?$/

export function isContainer(name: string): boolean {
  const w = wordsOf(name)
  return CONTAINER.test(w) || /^\d{4}$/.test(w)
}

/**
 * The album paths of a chosen folder's files (each given as its folders, camera folders left out):
 * the chosen folder itself and the containers at the top (My Pictures, My Pictures2004…) dropped, so the
 * first folder left is the album ("myBackup/My Pictures2004/anniv papa" → "anniv papa").
 */
export function albumDirs(dirs: string[][]): string[][] {
  const top = dirs[0]?.[0]
  const single = top !== undefined && dirs.every((d) => d[0] === top)
  return dirs.map((d) => {
    const rest = single ? d.slice(1) : d
    let k = 0
    while (k < rest.length - 1 && isContainer(rest[k])) k++
    // A container with photos directly in it is no album either.
    if (k === rest.length - 1 && isContainer(rest[k])) k++
    return rest.slice(k)
  })
}

/** The albums of a chosen folder (looking inside the containers), with how many files each holds. */
export function foldersOfFiles(paths: string[]): FolderName[] {
  const dirs = albumDirs(paths.map((p) => albumPath(p.split('/').slice(0, -1))))
  const counts = new Map<string, number>()
  for (const d of dirs) if (d[0]) counts.set(d[0], (counts.get(d[0]) ?? 0) + 1)
  return sorted(counts)
}

/** The folders as the "tree" command prints them (what MyMedia read), with their number at the end. */
export function treeText(rootName: string, dirs: string[][]): string {
  type Node = Map<string, Node>
  const root: Node = new Map()
  for (const d of dirs) {
    let n = root
    for (const part of d) {
      if (!n.has(part)) n.set(part, new Map())
      n = n.get(part)!
    }
  }
  const lines = [rootName]
  const draw = (n: Node, prefix: string) => {
    const names = [...n.keys()].sort((a, b) => a.localeCompare(b))
    names.forEach((name, i) => {
      const last = i === names.length - 1
      lines.push(`${prefix}${last ? '└── ' : '├── '}${name}`)
      draw(n.get(name)!, prefix + (last ? '    ' : '│   '))
    })
  }
  draw(root, '')
  return `${lines.join('\n')}\n\n${dirs.length} directories\n`
}
