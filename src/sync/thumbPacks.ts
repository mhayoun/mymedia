// Thumbnail packs: the thumbnails of an album in a few files of the _thumbs
// folder (60 a file, about 1 MB, oldest first, so new photos change only the last one).
// A device opening an album for the first time downloads one file instead
// of asking Drive for each thumbnail. Made by the computers that can write
// the library (not phones: it would slow what they show), after each load
// from Drive; read by every device, the read-only ones too. What is not in a pack (yet) is loaded one by one as before.

import { db, type MediaRecord } from '../db/db'
import { createFolder, deleteFilePermanently, downloadBlob, findChildByName, listFiles, writeDataFile } from '../drive/api'
import { folderChain, isReservedFolderName, parsePendingAlbum, type FolderNode } from '../lib/tree'
import { app, withStep } from '../store'
import { afterScreenThumbs, driveThumbnail, isFastConnection, thumbVersion } from './thumbs'

export const PACKS_FOLDER = '_thumbs'
const CHUNK = 60
const PACK_SIZE = 320
const QUALITY = 0.72
const MAGIC = 'MMT1'
const BUILD_PARALLEL = 6

interface PackFile {
  id: string
  hash?: string
}

/** Packs in Drive, by name ("<folder id>.<n>"). */
let packs = new Map<string, PackFile>()
/** Media id → its pack and how many thumbnails the pack holds. */
let index = new Map<string, { key: string; count: number }>()
/** Downloaded packs: their thumbnails, by media id (shown from memory, kept on the device meanwhile). */
const loads = new Map<string, Promise<Map<string, PackThumb>>>()

export interface PackThumb {
  id: string
  version: string
  blob: Blob
}

export function packOf(mediaId: string): { key: string; count: number } | undefined {
  return index.get(mediaId)
}

/** True once the pack was downloaded in this visit (what it lacks is loaded one by one). */
export function packLoaded(key: string): boolean {
  return loads.has(key)
}

/** The media of each folder, in packs: oldest first, 60 a pack. */
export function packGroups(media: MediaRecord[]): Map<string, MediaRecord[]> {
  const byFolder = new Map<string, MediaRecord[]>()
  for (const r of media) {
    const list = byFolder.get(r.folderId)
    if (list) list.push(r)
    else byFolder.set(r.folderId, [r])
  }
  const out = new Map<string, MediaRecord[]>()
  for (const [folder, list] of byFolder) {
    list.sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : a.id < b.id ? -1 : 1))
    for (let i = 0, n = 0; i < list.length; i += CHUNK, n++) out.set(`${folder}.${n}`, list.slice(i, i + CHUNK))
  }
  return out
}

/** Changes when a photo of the pack is added, removed or changed. */
export function packHash(list: MediaRecord[]): string {
  let h = 0x811c9dc5
  for (const r of list) {
    const s = `${r.id}:${thumbVersion(r)}|`
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  return (h >>> 0).toString(16)
}

async function packsFolder(create: boolean): Promise<string | null> {
  const rootId = app().rootId
  if (!rootId) return null
  const f = await findChildByName(rootId, PACKS_FOLDER)
  if (f) return f.id
  return create ? (await createFolder(PACKS_FOLDER, rootId)).id : null
}

async function listPacks(folderId: string): Promise<Map<string, PackFile>> {
  const out = new Map<string, PackFile>()
  await listFiles(`'${folderId}' in parents and trashed = false`, (files) => {
    for (const f of files) out.set(f.name.replace(/\.pack$/, ''), { id: f.id, hash: f.appProperties?.h })
  }, undefined, 'id,name,appProperties')
  return out
}

/** The media that have thumbnails in packs (not those of reserved folders like _Originals). */
async function packable(): Promise<MediaRecord[]> {
  const rootId = app().rootId!
  const d = db()
  const folders = new Map<string, FolderNode>((await d.folders.toArray()).map((f) => [f.id, f]))
  const reserved = new Map<string, boolean>()
  const isReserved = (id: string) => {
    let r = reserved.get(id)
    if (r === undefined) {
      r = id !== rootId && !!folderChain(id, folders, rootId)?.some((f) => isReservedFolderName(f.name))
      reserved.set(id, r)
    }
    return r
  }
  return (await d.media.toArray()).filter((m) => !parsePendingAlbum(m.folderId) && !isReserved(m.folderId))
}

/** Learns which packs exist (one request); called after each load from Drive. */
export async function preparePacks(): Promise<void> {
  try {
    const folder = await packsFolder(false)
    packs = folder ? await listPacks(folder) : new Map()
    const next = new Map<string, { key: string; count: number }>()
    if (packs.size) {
      for (const [key, list] of packGroups(await packable())) {
        if (packs.has(key)) for (const r of list) next.set(r.id, { key, count: list.length })
      }
    }
    index = next
  } catch (e) {
    console.warn('[MyMedia] thumbnail packs', e)
  }
}

/** Downloads a pack once; its thumbnails are given at once and kept on the device in the background. */
export function loadPack(key: string): Promise<Map<string, PackThumb>> {
  let run = loads.get(key)
  if (!run) {
    run = (async () => {
      const file = packs.get(key)
      if (!file) return new Map<string, PackThumb>()
      const thumbs = readPack(new Uint8Array(await (await downloadBlob(file.id)).arrayBuffer()))
      if (thumbs.length) void db().thumbs.bulkPut(thumbs).catch(() => undefined)
      return new Map(thumbs.map((t) => [t.id, t]))
    })().catch((e) => {
      console.warn('[MyMedia] thumbnail pack', key, e)
      return new Map<string, PackThumb>()
    })
    loads.set(key, run)
  }
  return run
}

export function readPack(bytes: Uint8Array): PackThumb[] {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) return []
  const len = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as { items: [string, string, number, number][] }
  const base = 8 + len
  const out: PackThumb[] = []
  for (const [id, version, offset, length] of header.items) {
    const data = bytes.slice(base + offset, base + offset + length)
    const type = imageType(data)
    // Only pictures (a damaged pack must not show empty squares).
    if (type && data.length === length) out.push({ id, version, blob: new Blob([data], { type }) })
  }
  return out
}

function imageType(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'image/webp'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  return null
}

export async function writePack(items: { id: string; version: string; blob: Blob }[]): Promise<Blob> {
  const parts: Uint8Array[] = []
  const entries: [string, string, number, number][] = []
  let offset = 0
  for (const it of items) {
    const b = new Uint8Array(await it.blob.arrayBuffer())
    entries.push([it.id, it.version, offset, b.length])
    parts.push(b)
    offset += b.length
  }
  const header = new TextEncoder().encode(JSON.stringify({ items: entries }))
  const head = new Uint8Array(8)
  head.set(new TextEncoder().encode(MAGIC))
  new DataView(head.buffer).setUint32(4, header.length, true)
  return new Blob([head, header, ...parts] as BlobPart[], { type: 'application/octet-stream' })
}

async function shrink(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, PACK_SIZE / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY })
    return small.size < blob.size ? small : blob
  } catch {
    return blob
  }
}

/** The thumbnails of a pack: those already on the device, the others from Drive. */
async function thumbsFor(list: MediaRecord[]): Promise<{ id: string; version: string; blob: Blob }[]> {
  const d = db()
  const stored = await d.thumbs.bulkGet(list.map((r) => r.id))
  const out: ({ id: string; version: string; blob: Blob } | null)[] = new Array(list.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      const r = list[i]
      const version = thumbVersion(r)
      const s = stored[i]
      let blob = s && (s.version === version || s.version === r.modifiedTime) ? s.blob : null
      if (!blob) {
        await afterScreenThumbs() // what the user is looking at comes first
        blob = await driveThumbnail(r, PACK_SIZE).catch(() => null)
        if (blob) await d.thumbs.put({ id: r.id, version, blob })
      }
      if (blob) out[i] = { id: r.id, version, blob: await shrink(blob) }
    }
  }
  await Promise.all(Array.from({ length: BUILD_PARALLEL }, worker))
  return out.filter((x): x is NonNullable<typeof x> => !!x)
}

let building: Promise<void> | null = null

const isPhone = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)

/** Makes the missing or outdated packs (computers that can write the library). */
export function buildPacks(): Promise<void> {
  if (app().readOnly || !app().rootId || !navigator.onLine || isPhone() || !isFastConnection()) return Promise.resolve()
  building ??= (async () => {
    const groups = packGroups(await packable())
    if (!groups.size) return
    const folder = await packsFolder(true)
    if (!folder) return
    const existing = await listPacks(folder)
    const todo = [...groups].filter(([key, list]) => existing.get(key)?.hash !== packHash(list))
    const stale = [...existing].filter(([key]) => !groups.has(key))
    if (todo.length || stale.length) {
      await withStep('sync.packing', async () => {
        for (const [key, list] of todo) {
          if (app().readOnly || !navigator.onLine || !isFastConnection()) break
          const items = await thumbsFor(list)
          if (!items.length) continue
          try {
            const f = await writeDataFile(existing.get(key)?.id ?? null, `${key}.pack`, folder, await writePack(items), { h: packHash(list), n: String(items.length) })
            existing.set(key, { id: f.id, hash: packHash(list) })
          } catch (e) {
            console.warn('[MyMedia] thumbnail pack not saved', key, e)
          }
        }
        for (const [key, f] of stale) {
          await deleteFilePermanently(f.id).catch(() => undefined)
          existing.delete(key)
        }
      })
    }
    await preparePacks()
  })()
    .catch((e) => console.warn('[MyMedia] thumbnail packs', e))
    .finally(() => {
      building = null
    })
  return building
}
