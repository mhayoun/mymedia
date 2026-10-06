// Local cache in IndexedDB, one database per Google account.

import Dexie, { type Table } from 'dexie'
import type { MediaType } from '../lib/media'
import type { MediaMeta } from '../lib/metadata'
import type { FolderNode } from '../lib/tree'

/** What Drive tells us about a media file (Drive is the source of truth). */
export interface MediaRecord {
  id: string
  name: string
  mimeType: string
  type: MediaType
  folderId: string
  size: number
  md5?: string
  createdTime: string
  modifiedTime: string
  /** EXIF date, else date from the file name, else Drive creation date. */
  takenAt: string
  width?: number
  height?: number
  durationMs?: number
  cameraMake?: string
  cameraModel?: string
  thumbnailLink?: string
  webViewLink?: string
  appProperties?: Record<string, string>
}

export interface ThumbRecord {
  id: string
  /** modifiedTime of the file when the thumbnail was made. */
  version: string
  blob: Blob
}

/** Image fingerprint of a media file, for the learned classifier. */
export interface EmbeddingRecord {
  id: string
  /** md5 (or modifiedTime) of the file when the fingerprint was made. */
  version: string
  vec?: Int8Array
  /** The file could not be read (e.g. format not supported): not retried until it changes. */
  failed?: boolean
}

/** A face found in a media file. */
export interface FaceRecord {
  /** `${mediaId}#${n}` */
  id: string
  mediaId: string
  /** Version (md5) of the media when the face was found. */
  version: string
  /** Position in the picture, 0..1: x, y, width, height. */
  box: [number, number, number, number]
  score: number
  emb: Int8Array
  /** Group (person) of this face; null = removed from its group by the user. */
  personId: string | null
  /** 'auto' = grouped by MyMedia, 'manual' = decided by the user. */
  by: 'auto' | 'manual'
  /** A named person this face probably is (waiting for confirmation). */
  suggested?: string
  /** People this face is NOT (the user removed it from them). */
  rejected?: string[]
  updatedAt: number
}

/** A group of faces of the same person; named or not yet. */
export interface PersonRecord {
  id: string
  name?: string
  updatedAt: number
  /** This group was merged into another one. */
  mergedInto?: string
}

export interface KvRecord {
  key: string
  value: unknown
}

export class MyMediaDB extends Dexie {
  media!: Table<MediaRecord, string>
  folders!: Table<FolderNode, string>
  meta!: Table<MediaMeta, string>
  thumbs!: Table<ThumbRecord, string>
  embeddings!: Table<EmbeddingRecord, string>
  faces!: Table<FaceRecord, string>
  faceCrops!: Table<{ id: string; blob: Blob }, string>
  /** Media already searched for faces: id → version. */
  faceScans!: Table<{ id: string; version: string }, string>
  persons!: Table<PersonRecord, string>
  kv!: Table<KvRecord, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      media: '&id, folderId, type, takenAt',
      folders: '&id, parentId',
      meta: '&id',
      thumbs: '&id',
      kv: '&key',
    })
    this.version(2).stores({ embeddings: '&id' })
    this.version(3).stores({ faces: '&id, mediaId, personId', faceCrops: '&id', faceScans: '&id', persons: '&id' })
  }

  async getKv<T>(key: string): Promise<T | undefined> {
    return (await this.kv.get(key))?.value as T | undefined
  }

  async setKv(key: string, value: unknown): Promise<void> {
    await this.kv.put({ key, value })
  }
}

let current: MyMediaDB | null = null

export function openDb(email: string): MyMediaDB {
  const name = `mymedia:${email.toLowerCase()}`
  if (current?.name === name) return current
  current?.close()
  current = new MyMediaDB(name)
  return current
}

export function db(): MyMediaDB {
  if (!current) throw new Error('Database not open')
  return current
}

export function hasDb(): boolean {
  return current !== null
}
