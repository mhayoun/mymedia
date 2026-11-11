// The albums a chosen folder gives, from the names of its folders and sub-folders only (no photo opened):
// from the files of a folder chosen on the computer, or from a pasted list (one folder per line, or what
// the "tree" command prints). Camera folders (DCIM, 100NIKON…) left out, like at import. Pure, tested.
import { albumNameOf, albumPath } from './cameraFolders'

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

/** From a pasted list: the first-level folders, with how many sub-folders each has. */
export function foldersOfText(text: string): FolderName[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() && l.trim() !== '.' && !/^\d+ director(y|ies)/.test(l.trim()))
  const counts = new Map<string, number>()
  const add = (name: string | undefined, sub: boolean) => {
    const n = name ? albumNameOf(name) : null
    if (n) counts.set(n, (counts.get(n) ?? 0) + (sub ? 1 : 0))
  }
  if (lines.some((l) => l.includes('── '))) {
    // "tree": "├── name" at the first level, "│   ├── sub" below.
    let current: string | undefined
    for (const l of lines) {
      const at = l.indexOf('── ')
      if (at < 0) continue
      const name = l.slice(at + 3).trim()
      if ((at - 1) / 4 === 0) {
        current = name
        add(name, false)
      } else add(current, true)
    }
    return sorted(counts)
  }
  const paths = lines.map((l) => l.trim().replace(/^\.\//, '').split(/[\\/]/).filter(Boolean))
  const top = paths[0]?.[0]
  const single = paths.length > 1 && top !== undefined && paths.every((p) => p[0] === top)
  for (const p of paths) {
    const rest = single ? p.slice(1) : p
    add(rest[0], rest.length > 1)
  }
  return sorted(counts)
}
