// Thumbnail packs: the thumbnails of an album in one file of the _thumbs
// folder (150 a file, oldest first, so new photos change only the last one).
// A device opening an album for the first time downloads one file instead
// of asking Drive for each thumbnail. Made by the devices that can write the
// library, after each load from Drive; read by every device, the read-only
// ones too. What is not in a pack (yet) is loaded one by one as before.

import { db, type MediaRecord } from '../db/db'
import { createFolder, deleteFilePermanently, downloadBlob, findChildByName, listFiles, writeDataFile } from '../drive/api'
import { folderChain, isReservedFolderName, parsePendingAlbum, type FolderNode } from '../lib/tree'
import { app, withStep } from '../store'
import { afterScreenThumbs, driveThumbnail, isFastConnection, thumbVersion } from './thumbs'

export const PACKS_FOLDER = '_thumbs'
const CHUNK = 150
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
const loads = new Map<string, Promise<void>>()

export function packOf(mediaId: string): { key: string; count: number } | undefined {
  return index.get(mediaId)
}

/** True once the pack was downloaded in this visit (what it lacks is loaded one by one). */
export function packLoaded(key: string): boolean {
  return loads.has(key)
}

/** The media of each folder, in packs: oldest first, 150 a pack. */
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

/** Downloads a pack once and keeps its thumbnails on the device. */
export function loadPack(key: string): Promise<void> {
  let run = loads.get(key)
  if (!run) {
    run = (async () => {
      const file = packs.get(key)
      if (!file) return
      const bytes = new Uint8Array(await (await downloadBlob(file.id)).arrayBuffer())
      const thumbs = readPack(bytes)
      if (thumbs.length) await db().thumbs.bulkPut(thumbs)
    })().catch((e) => console.warn('[MyMedia] thumbnail pack', key, e))
    loads.set(key, run)
  }
  return run
}

export function readPack(bytes: Uint8Array): { id: string; version: string; blob: Blob }[] {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) return []
  const len = new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as { items: [string, string, number, number][] }
  const base = 8 + len
  return header.items.map(([id, version, offset, length]) => ({
    id,
    version,
    blob: new Blob([bytes.slice(base + offset, base + offset + length)], { type: 'image/jpeg' }),
  }))
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

/** Makes the missing or outdated packs (devices that can write the library, on Wi-Fi). */
export function buildPacks(): Promise<void> {
  if (app().readOnly || !app().rootId || !navigator.onLine || !isFastConnection()) return Promise.resolve()
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
