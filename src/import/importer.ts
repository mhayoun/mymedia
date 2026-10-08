// Upload of photos and videos from the device (or a USB stick / SD card) to
// Drive, keeping their real date: EXIF for photos, recording date for
// videos, else the date in the file name, else the file's own date.
// Files are compressed before upload, and duplicates (same content as a file
// already in Drive) are detected by MD5.

import SparkMD5 from 'spark-md5'
import { canCompressVideo, compressPhoto, compressVideo, localVideoDuration } from '../compress/media'
import { db } from '../db/db'
import { createMediaFile, ensureFolderPath } from '../drive/api'
import { isJpegMime, planCompression } from '../lib/compressPlan'
import { exifDateTime, heicExif, jpegDimensions, jpegExif } from '../lib/jpeg'
import { dateFromFileName, detectOrigin, localIso, mediaTypeOf, type MediaType } from '../lib/media'
import { mp4CreationTime } from '../lib/mp4'
import { app } from '../store'
import type { FacebookPost } from './facebook'
import { replaceContent } from './replace'
import { syncNow, toRecord } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'

export type DateSource = 'exif' | 'video' | 'name' | 'file' | 'facebook'

export interface ImportItem {
  key: string
  file: File
  /** Sub-folders of the chosen folder, e.g. ["Trip", "Day 1"]. */
  relDir: string[]
  type: MediaType
  mimeType: string
  /** Local date-time "YYYY-MM-DDTHH:mm:ss". */
  takenAt: string
  dateSource: DateSource
  md5: string
  duplicate: boolean
  /** Estimated size after compression, or null if it will be uploaded as is. */
  estimate: number | null
  /** Text, group and species from a Facebook post. */
  extra?: { description?: string; group?: string; species?: string }
  /** A reduced version of this photo already in Drive, replaced by this file. */
  replaces?: import('./replace').Replacement
  /** Duplicate found by look (same photo already in Drive, not clearly smaller). */
  sameLook?: boolean
}

export type ImportOutcome =
  | { status: 'waiting' }
  | { status: 'compressing'; progress: number }
  | { status: 'uploading'; progress: number }
  | { status: 'done'; size: number }
  | { status: 'error' }

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime',
}

function mimeOf(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type || MIME_BY_EXT[ext] || 'application/octet-stream'
}

async function md5Of(file: Blob): Promise<string> {
  const spark = new SparkMD5.ArrayBuffer()
  const CHUNK = 8 * 1024 * 1024
  for (let pos = 0; pos < file.size; pos += CHUNK) spark.append(await file.slice(pos, pos + CHUNK).arrayBuffer())
  return spark.end()
}

/** Media files among the chosen files (others are ignored). */
export function mediaFiles(files: File[]): File[] {
  return files.filter((f) => mediaTypeOf(mimeOf(f), f.name) !== null)
}

/** Reads date, MD5 and estimated compression of each file. */
export async function analyze(files: File[], onProgress: (done: number) => void): Promise<ImportItem[]> {
  const known = new Set((await db().media.toArray()).map((m) => m.md5).filter(Boolean))
  const seen = new Set<string>()
  const s = app().settings.compress
  const videoOk = await canCompressVideo()
  const items: ImportItem[] = []
  for (const [i, file] of files.entries()) {
    const mimeType = mimeOf(file)
    const type = mediaTypeOf(mimeType, file.name)!
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
    const relDir = path ? path.split('/').slice(0, -1) : []
    let taken: string | null = null
    let dateSource: DateSource = 'file'
    let width: number | undefined
    let height: number | undefined
    let durationMs: number | undefined

    if (type === 'photo') {
      const head = new Uint8Array(await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer())
      const tiff = isJpegMime(mimeType, file.name) ? jpegExif(head) : /hei[cf]/i.test(mimeType + file.name) ? heicExif(head) : null
      taken = tiff ? exifDateTime(tiff) : null
      if (taken) dateSource = 'exif'
      const dims = jpegDimensions(head)
      width = dims?.width
      height = dims?.height
    } else {
      const created = await mp4CreationTime(async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer()), file.size).catch(() => null)
      if (created) {
        taken = localIso(created)
        dateSource = 'video'
      }
      if (videoOk) durationMs = await localVideoDuration(file)
    }
    if (!taken) {
      taken = dateFromFileName(file.name) ?? null
      if (taken) dateSource = 'name'
    }
    if (!taken) taken = localIso(new Date(file.lastModified || Date.now()))

    const md5 = await md5Of(file)
    const duplicate = known.has(md5) || seen.has(md5)
    seen.add(md5)

    const plan = planCompression(
      { name: file.name, type, mimeType, size: file.size, width, height, durationMs, createdTime: '', origin: 'import' },
      s,
      { mode: 'manual', videoSupported: videoOk },
    )
    const estimate = plan.ok ? plan.estimate : null

    items.push({ key: `${path || file.name}:${i}`, file, relDir, type, mimeType, takenAt: taken, dateSource, md5, duplicate, estimate })
    onProgress(i + 1)
  }
  return items
}

/**
 * Facebook export: the date, text and group of each post. Files already in
 * Drive under the same name (an earlier import of the same export) are
 * marked as duplicates, so only new posts are proposed.
 */
export async function withFacebookPosts(items: ImportItem[], posts: Map<string, FacebookPost>): Promise<ImportItem[]> {
  const names = new Set((await db().media.toArray()).map((m) => m.name))
  return items.map((i) => {
    const post = posts.get(i.file.name)
    if (!post) return i
    const own = i.dateSource === 'exif' || i.dateSource === 'video'
    return {
      ...i,
      relDir: [],
      takenAt: !own && post.date ? post.date : i.takenAt,
      dateSource: !own && post.date ? 'facebook' : i.dateSource,
      duplicate: i.duplicate || names.has(i.file.name),
      extra: { description: post.description ?? undefined, group: post.group ?? undefined },
    }
  })
}

let abort: AbortController | null = null

export function cancelImport() {
  abort?.abort()
}

/** Compresses (if chosen) and uploads each file into destId, with its real date. */
export async function runImport(
  items: ImportItem[],
  destId: string,
  opts: { compress: boolean; keepFolders: boolean; from: string },
  onItem: (key: string, o: ImportOutcome) => void,
): Promise<{ count: number; before: number; after: number }> {
  abort = new AbortController()
  const signal = abort.signal
  const s = app().settings.compress
  const folderCache = new Map<string, string>()
  const d = db()
  const imported = { from: opts.from, on: localIso(new Date()).slice(0, 10) }
  let count = 0
  let before = 0
  let after = 0
  try {
    for (const item of items) {
      if (signal.aborted) break
      try {
        if (item.replaces) {
          onItem(item.key, { status: 'uploading', progress: 0 })
          const size = await replaceContent(item, imported, (p) => onItem(item.key, { status: 'uploading', progress: p }), signal)
          count++
          before += item.replaces.size
          after += size
          onItem(item.key, { status: 'done', size })
          continue
        }
        let parent = destId
        if (opts.keepFolders && item.relDir.length) {
          const k = item.relDir.join('/')
          if (!folderCache.has(k)) folderCache.set(k, await ensureFolderPath(destId, item.relDir))
          parent = folderCache.get(k)!
        }

        let blob: Blob = item.file
        let name = item.file.name
        let mimeType = item.mimeType
        let compressed = false
        if (opts.compress && item.estimate !== null) {
          onItem(item.key, { status: 'compressing', progress: 0 })
          const out =
            item.type === 'photo'
              ? await compressPhoto({ name, mimeType }, item.file, s)
              : await compressVideo(item.file, s, (p) => onItem(item.key, { status: 'compressing', progress: p }), signal)
          if (out.size <= item.file.size * (1 - s.minGain)) {
            blob = out
            compressed = true
            if (item.type === 'photo' && !isJpegMime(mimeType, name)) name = name.replace(/\.[^.]+$/, '') + '.jpg'
            if (item.type === 'video') name = name.replace(/\.mov$/i, '.mp4')
            mimeType = item.type === 'photo' ? 'image/jpeg' : 'video/mp4'
          }
        }

        onItem(item.key, { status: 'uploading', progress: 0 })
        const date = new Date(item.takenAt).toISOString()
        const file = await createMediaFile(
          blob,
          {
            name,
            parents: [parent],
            mimeType,
            createdTime: date,
            modifiedTime: date,
            appProperties: {
              mymedia_taken: item.takenAt,
              ...(compressed
                ? { mymedia_compressed: '1', mymedia_quality: String(Math.round(s.quality * 100)), mymedia_original_size: String(item.file.size) }
                : {}),
            },
          },
          (p) => onItem(item.key, { status: 'uploading', progress: p }),
          signal,
        )

        const rec = toRecord(file)
        if (rec) {
          rec.takenAt = item.takenAt
          await d.media.put(rec)
          const detected = detectOrigin({ name: item.file.name, type: item.type, folderPath: item.relDir.join('/') })
          await d.meta.put({
            id: rec.id,
            name,
            type: item.type,
            takenAt: item.takenAt,
            origin: detected === 'unknown' ? 'import' : detected,
            source: item.extra?.species ? 'manual' : 'folder',
            description: item.extra?.description,
            group: item.extra?.group,
            imported,
            species: item.extra?.species ? { he: item.extra.species } : undefined,
            compression: compressed
              ? { status: 'compressed', sizeBefore: item.file.size, sizeAfter: blob.size, date: new Date().toISOString() }
              : undefined,
            updatedAt: Date.now(),
          })
        }
        count++
        before += item.file.size
        after += blob.size
        onItem(item.key, { status: 'done', size: blob.size })
      } catch (e) {
        if (signal.aborted) break
        console.error('[MyMedia] import failed', item.file.name, e)
        onItem(item.key, { status: 'error' })
      }
    }
  } finally {
    abort = null
    if (count) {
      await markMetaDirty()
      void syncNow() // brings in the new folders; then learning and classification
    }
  }
  return { count, before, after }
}
