// The mymedia.json format, shared between all of a user's devices.

import type { MediaType, Origin } from './media'

export type ClassificationSource = 'folder' | 'filename' | 'model' | 'ai' | 'manual'

export interface SpeciesNames {
  he?: string
  fr?: string
  en?: string
  la?: string
}

export interface CompressionInfo {
  status: 'compressed' | 'already' | 'none' | 'declined'
  sizeBefore?: number
  sizeAfter?: number
  date?: string
}

export interface Suggestion {
  /** Destination folder (album, or category for media at the root). */
  folderId: string
  confidence: number
}

export interface MediaMeta {
  id: string
  name: string
  type: MediaType
  /** Local date-time "YYYY-MM-DDTHH:mm:ss" (EXIF), else Drive creation date (ISO). */
  takenAt?: string
  origin: Origin
  originManual?: boolean
  category?: string | null
  album?: string | null
  description?: string | null
  /** Facebook group the photo was posted in (Facebook export, Katia). */
  group?: string | null
  /** The import that brought the media: folder or ZIP name ('' = loose files) and day. */
  imported?: import('./provenance').ImportInfo | null
  source?: ClassificationSource
  species?: SpeciesNames | null
  confidence?: number | null
  toCheck?: boolean
  /** Resembles no album enough: probably belongs to an album that does not exist yet. */
  novel?: boolean
  /** Proposed destinations, best first (waiting for the user). */
  suggestions?: Suggestion[]
  /** Moved automatically by the learned model, not yet reviewed. */
  auto?: boolean
  /** The user said this media stays where it is (no more suggestions). */
  keepHere?: boolean
  /** Names of the people recognised in the media (faces) and added by hand. */
  people?: string[] | null
  /** People added by hand (photos where the face is not visible or not found). */
  peopleManual?: string[]
  compression?: CompressionInfo | null
  /** Epoch ms of the last change; the newest version of an item wins on merge. */
  updatedAt: number
  /** Tombstone: the media was removed from Drive. */
  deleted?: boolean
}

export interface MetaFile {
  format: 'mymedia'
  version: 1
  updatedAt: number
  items: Record<string, MediaMeta>
}

export const META_FILE_NAME = 'mymedia.json'
/**
 * What was learnt about a media and cannot be found again from the file. A newer version
 * without one of them (a device that only had a blank copy) does not erase it: removing
 * one on purpose writes null.
 */
const KEPT = ['description', 'group', 'imported', 'species', 'people', 'peopleManual', 'compression'] as const
const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000

export function emptyMetaFile(): MetaFile {
  return { format: 'mymedia', version: 1, updatedAt: 0, items: {} }
}

/** Accepts anything read from Drive and returns a valid MetaFile. */
export function parseMetaFile(text: string): MetaFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('mymedia.json is not valid JSON')
  }
  const obj = raw as Partial<MetaFile>
  if (!obj || typeof obj !== 'object' || obj.format !== 'mymedia' || typeof obj.items !== 'object') {
    throw new Error('mymedia.json has an unknown format')
  }
  return {
    format: 'mymedia',
    version: 1,
    updatedAt: Number(obj.updatedAt) || 0,
    items: obj.items ?? {},
  }
}

/**
 * Merges two versions item by item: for each media the version with the
 * most recent updatedAt wins, so edits made on two devices are both kept.
 */
export function mergeMetaFiles(a: MetaFile, b: MetaFile, now = Date.now()): MetaFile {
  const items: Record<string, MediaMeta> = {}
  for (const src of [a.items, b.items]) {
    for (const [id, item] of Object.entries(src)) {
      const cur = items[id]
      if (!cur) items[id] = item
      else if (item.updatedAt > cur.updatedAt) items[id] = keepKnown(item, cur)
      else items[id] = keepKnown(cur, item)
    }
  }
  for (const [id, item] of Object.entries(items)) {
    if (item.deleted && now - item.updatedAt > TOMBSTONE_TTL_MS) delete items[id]
  }
  return { format: 'mymedia', version: 1, updatedAt: Math.max(a.updatedAt, b.updatedAt), items }
}

/**
 * Many media gone at once, more likely a list of Drive read only in part than a real
 * removal: each one is then checked in Drive before it becomes a tombstone.
 */
export function isMassRemoval(removed: number, known: number): boolean {
  return removed >= 20 && removed > known * 0.1
}

/** The newer version, with what only the older one knew (see KEPT). */
function keepKnown(newer: MediaMeta, older: MediaMeta): MediaMeta {
  let out = newer
  for (const k of KEPT) {
    if (newer[k] === undefined && older[k] !== undefined && older[k] !== null) {
      if (out === newer) out = { ...newer }
      ;(out as unknown as Record<string, unknown>)[k] = older[k]
    }
  }
  return out
}

/** True when both versions hold the same data (updatedAt ignored). */
export function isSameMeta(a: MediaMeta, b: MediaMeta): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}
