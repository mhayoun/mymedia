// The albums a chosen folder gives, from the names of its folders and sub-folders only (no photo opened):
// from the files of a folder chosen on the computer, and the tree as text (like what
// the "tree" command prints, for the tree shown). Camera folders (DCIM, 100NIKON…) left out, like at import. Pure, tested.
import { albumPath } from './cameraFolders'

export interface FolderName {
  name: string
  /** Files it holds (from a folder chosen), or its sub-folders (from a pasted list). */
  count: number
}

function sorted(counts: Map<string, number>): FolderName[] {
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
}

/** The chosen folder's sub-folders (its first level), with how many files each holds. */
export function foldersOfFiles(paths: string[]): FolderName[] {
  const dirs = paths.map((p) => albumPath(p.split('/').slice(0, -1)))
  const top = dirs[0]?.[0]
  const single = top !== undefined && dirs.every((d) => d[0] === top)
  const counts = new Map<string, number>()
  for (const d of dirs) {
    const name = (single ? d.slice(1) : d)[0]
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
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
