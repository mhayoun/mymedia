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
  description?: string
  /** Facebook group the photo was posted in (Facebook export, Katia). */
  group?: string
  source?: ClassificationSource
  species?: SpeciesNames | null
  confidence?: number | null
  toCheck?: boolean
  /** Proposed destinations, best first (waiting for the user). */
  suggestions?: Suggestion[]
  /** Moved automatically by the learned model, not yet reviewed. */
  auto?: boolean
  /** The user said this media stays where it is (no more suggestions). */
  keepHere?: boolean
  /** Names of the people recognised in the media (faces) and added by hand. */
  people?: string[]
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
      if (!cur || item.updatedAt > cur.updatedAt) items[id] = item
    }
  }
  for (const [id, item] of Object.entries(items)) {
    if (item.deleted && now - item.updatedAt > TOMBSTONE_TTL_MS) delete items[id]
  }
  return { format: 'mymedia', version: 1, updatedAt: Math.max(a.updatedAt, b.updatedAt), items }
}

/** True when both versions hold the same data (updatedAt ignored). */
export function isSameMeta(a: MediaMeta, b: MediaMeta): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 })
}
