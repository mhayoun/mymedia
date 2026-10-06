// Search words and extra filters of the gallery (pure, tested).

import { nameKey } from './filename'
import type { MediaMeta } from './metadata'

export type CompressionState = 'compressed' | 'already' | 'not'

export function compressionState(appProperties: Record<string, string> | undefined, meta: MediaMeta | undefined): CompressionState {
  if (appProperties?.mymedia_compressed || meta?.compression?.status === 'compressed') return 'compressed'
  if (meta?.compression?.status === 'already') return 'already'
  return 'not'
}

/** Everything a search can find for one media: name, description, album, people, species. */
export function searchText(name: string, meta: MediaMeta | undefined, category: string | null, album: string | null): string {
  const s = meta?.species
  return nameKey(
    [name, meta?.description, category, album, ...(meta?.people ?? []), s?.he, s?.fr, s?.en, s?.la].filter(Boolean).join(' '),
  )
}

/** True when every word of the query appears (accents, case and Hebrew vowel points ignored). */
export function matchesQuery(text: string, query: string): boolean {
  const words = nameKey(query).split(' ').filter(Boolean)
  return words.every((w) => text.includes(w))
}
