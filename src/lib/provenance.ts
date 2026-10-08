// Where media came from: the Facebook group it was posted in, and the import
// that brought it (folder or ZIP name, and day). Pure helpers, tested.

import type { MediaMeta } from './metadata'

/** One import: what was chosen ('' = files chosen one by one) and the day. */
export interface ImportInfo {
  from: string
  /** Local day "YYYY-MM-DD" ('' when unknown). */
  on: string
  /** Folder imported into Katia, the earlier app (photos reduced by it). */
  via?: 'katia'
}

export interface ProvenanceEntry {
  /** Filter key: "g:<group>" or "i:<day>|<via>|<from>". */
  key: string
  label: string
  /** Import day (imports only; '' when unknown). */
  on?: string
  via?: 'katia'
  count: number
}

export interface Provenance {
  groups: ProvenanceEntry[]
  /** Newest first. */
  imports: ProvenanceEntry[]
}

export const groupKey = (group: string) => `g:${group}`
export const importKey = (i: ImportInfo) => `i:${i.on}|${i.via ?? ''}|${i.from}`

/** The filter keys a media matches. */
export function provenanceKeys(meta: MediaMeta | undefined): string[] {
  const keys: string[] = []
  if (meta?.group) keys.push(groupKey(meta.group))
  if (meta?.imported) keys.push(importKey(meta.imported))
  return keys
}

export function buildProvenance(metas: Iterable<MediaMeta | undefined>): Provenance {
  const groups = new Map<string, ProvenanceEntry>()
  const imports = new Map<string, ProvenanceEntry>()
  for (const m of metas) {
    if (m?.group) {
      const key = groupKey(m.group)
      const e = groups.get(key) ?? { key, label: m.group, count: 0 }
      e.count++
      groups.set(key, e)
    }
    if (m?.imported) {
      const key = importKey(m.imported)
      const e = imports.get(key) ?? { key, label: m.imported.from, on: m.imported.on, via: m.imported.via, count: 0 }
      e.count++
      imports.set(key, e)
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return {
    groups: [...groups.values()].sort((a, b) => b.count - a.count || collator.compare(a.label, b.label)),
    imports: [...imports.values()].sort((a, b) => b.on!.localeCompare(a.on!) || collator.compare(a.label, b.label)),
  }
}

/** Name of what was imported: the chosen folder, the ZIP (without ".zip"), or '' for loose files. */
export function importSourceName(opts: { zipName?: string; relDirs: string[][] }): string {
  if (opts.zipName) return opts.zipName.replace(/\.zip$/i, '')
  return opts.relDirs.find((d) => d.length > 0)?.[0] ?? ''
}
