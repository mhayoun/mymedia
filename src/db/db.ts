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

export interface KvRecord {
  key: string
  value: unknown
}

export class MyMediaDB extends Dexie {
  media!: Table<MediaRecord, string>
  folders!: Table<FolderNode, string>
  meta!: Table<MediaMeta, string>
  thumbs!: Table<ThumbRecord, string>
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
