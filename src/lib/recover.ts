// Getting back what an earlier version of mymedia.json knew about the photos
// still in MyMedia (import, species, text, group, people…), when their entries
// were later started again from nothing. Only what is missing now is taken:
// nothing done since is overwritten. Pure, tested.

import type { MediaMeta, MetaFile } from './metadata'

/** Always the current value: where the photo is now and how it is being sorted. */
const CURRENT = new Set(['id', 'name', 'type', 'takenAt', 'category', 'album', 'source', 'confidence', 'toCheck', 'novel', 'suggestions', 'auto', 'updatedAt', 'deleted'])

export interface Recovery {
  patches: Map<string, Partial<MediaMeta>>
  /** Photos getting each kind of information back. */
  counts: Record<string, number>
}

export function planRecovery(current: Iterable<MediaMeta>, old: MetaFile): Recovery {
  const patches = new Map<string, Partial<MediaMeta>>()
  const counts: Record<string, number> = {}
  for (const cur of current) {
    if (cur.deleted) continue
    const before = old.items[cur.id]
    if (!before) continue
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(before)) {
      if (CURRENT.has(key) || value === undefined || value === null) continue
      const now = (cur as unknown as Record<string, unknown>)[key]
      // The origin chosen by hand wins over the one guessed from the file.
      const take = now === undefined || now === null || (key === 'origin' && before.originManual && !cur.originManual)
      if (take && JSON.stringify(now) !== JSON.stringify(value)) patch[key] = value
    }
    const keys = Object.keys(patch)
    if (!keys.length) continue
    patches.set(cur.id, patch as Partial<MediaMeta>)
    for (const k of keys) counts[k] = (counts[k] ?? 0) + 1
  }
  return { patches, counts }
}
