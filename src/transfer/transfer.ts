// Gives a category or an album of MyMedia, or all of it, to another Google account.
//
// Sender: every folder and file of the chosen folder is offered to the other
// account (Drive "pending owner"); a mymedia-transfer.json in the folder carries
// what MyMedia knows about each photo (species, description, group, people…).
// Receiver: accepts every offer, puts the folder at the same place in their own
// MyMedia (merging with a folder of the same name) and takes the metadata.
// Drive keeps the same file ids, so nothing is copied or uploaded again.
// The people found on the photos go with them (faces/transfer.ts).

import { db } from '../db/db'
import {
  about,
  acceptOwnership,
  childrenQuery,
  createTextFile,
  downloadText,
  findChildByName,
  findFolderNamed,
  folderNamed,
  getFile,
  listFiles,
  moveFile,
  moveInto,
  myPermissionId,
  offerOwnership,
  trashFile,
  type DriveFile,
} from '../drive/api'
import { facesOfGivenMedia, facesOfMedia, importFaces, type TransferFaces } from '../faces/transfer'
import { FOLDER_MIME } from '../lib/media'
import type { MediaMeta } from '../lib/metadata'
import { folderChain, subtreeIds } from '../lib/tree'
import { app } from '../store'
import { syncNow } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'

export const TRANSFER_FILE_NAME = 'mymedia-transfer.json'
/** Only the people of photos given earlier (before people went with them). */
export const PEOPLE_FILE_NAME = 'mymedia-people-transfer.json'

/**
 * MyMedia's own files at the root (index, faces, metadata, models bought):
 * they belong to the account, so "everything" leaves them out. The transfer
 * file itself goes with the photos.
 */
export function isMyMediaFile(f: { name: string; mimeType: string }): boolean {
  return f.mimeType !== FOLDER_MIME && /^mymedia[-.]/i.test(f.name) && f.name !== TRANSFER_FILE_NAME
}

/** A step that failed, with what the user needs to know. */
export class TransferError extends Error {
  step: 'notOwner' | 'send' | 'accept' | 'move' | 'peopleNotYet' | 'peopleNone'
  detail: string
  owner?: string
  constructor(step: TransferError['step'], detail: string, owner?: string) {
    super(detail)
    this.step = step
    this.detail = detail
    this.owner = owner
  }
}

async function step<T>(name: TransferError['step'], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof TransferError) throw e
    throw new TransferError(name, (e as Error).message)
  }
}

export interface TransferResult {
  total: number
  failed: number
  /** Google's reason for the first failure. */
  reason?: string
  /** Items that belong to another account (only their owner can give them). */
  skipped: number
  otherOwners: string[]
}

export interface TransferManifest {
  format: 'mymedia-transfer'
  version: 1
  from: string
  to: string
  /** The folder given (category or album, or the MyMedia root for everything). */
  folderId: string
  /** Names from the MyMedia root down to the folder, e.g. ["ציפורים"] or ["ציפורים", "חסידה"]; [] for everything. */
  path: string[]
  createdAt: number
  items: Record<string, MediaMeta>
  /** Who is on the photos (absent in transfers made before). */
  faces?: TransferFaces
  /** 'people': only `faces`, for photos given before. */
  kind?: 'people'
}

type Progress = (done: number, total: number) => void

/** Everything inside a folder (folders and files), the folder itself first. */
async function walk(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let level = [folderId]
  while (level.length) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 40) {
      await listFiles(childrenQuery(level.slice(i, i + 40)), (files) => {
        for (const f of files) {
          if (isMyMediaFile(f)) continue
          out.push(f)
          if (f.mimeType === FOLDER_MIME) next.push(f.id)
        }
      }, undefined, 'id,name,mimeType,parents,ownedByMe,owners(emailAddress)')
    }
    level = next
  }
  return out
}

/** Runs `fn` on each item, a few at a time; returns how many failed and the first reason. */
async function each<T>(items: T[], fn: (item: T) => Promise<void>, onProgress: Progress): Promise<{ failed: number; reason?: string }> {
  let done = 0
  let failed = 0
  let reason: string | undefined
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
      } catch (e) {
        console.error('[MyMedia] transfer', e)
        failed++
        reason ??= (e as Error).message
      }
      onProgress(++done, items.length)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  return { failed, reason }
}

// ---- Sender -------------------------------------------------------------------

/** Offers the folder and all it holds to `email`. Returns the number of items that failed. */
export async function sendFolder(folderId: string, email: string, message: string, onProgress: Progress): Promise<TransferResult> {
  const rootId = app().rootId!
  const d = db()
  await syncNow()
  const folders = await d.folders.toArray()
  // The root: all of MyMedia.
  const chain = folderId === rootId ? [] : folderChain(folderId, new Map(folders.map((f) => [f.id, f])), rootId)
  if (!chain || (!chain.length && folderId !== rootId)) throw new Error('not in MyMedia')

  const ids = subtreeIds(folderId, folders)
  const media = await d.media.where('folderId').anyOf([...ids]).toArray()
  const metas = await d.meta.bulkGet(media.map((m) => m.id))
  const items: Record<string, MediaMeta> = {}
  for (const m of metas) if (m && !m.deleted) items[m.id] = m

  const top = await getFile(folderId, 'id,name,ownedByMe,owners(emailAddress)')
  if (!top.ownedByMe) throw new TransferError('notOwner', top.name, top.owners?.[0]?.emailAddress)

  const me = await about()
  const faces = await facesOfMedia(new Set(media.map((m) => m.id)))
  const manifest: TransferManifest = {
    format: 'mymedia-transfer',
    version: 1,
    from: me.email,
    to: email.trim().toLowerCase(),
    folderId,
    path: chain.map((f) => f.name),
    createdAt: Date.now(),
    items,
    faces,
  }
  await step('send', async () => {
    // Replace an earlier manifest of the same folder (a transfer sent again).
    const old = await findChildByName(folderId, TRANSFER_FILE_NAME)
    if (old) await trashFile(old.id).catch(() => undefined)
    await createTextFile(TRANSFER_FILE_NAME, folderId, JSON.stringify(manifest))
    // The folder first, with the only e-mail; then everything inside.
    await offerOwnership(folderId, manifest.to, true, message || undefined)
  })
  const inside = await step('send', () => walk(folderId))
  const mine = inside.filter((f) => f.ownedByMe !== false)
  const others = inside.filter((f) => f.ownedByMe === false)
  const { failed, reason } = await each(mine, (f) => offerOwnership(f.id, manifest.to, false), (done, total) => onProgress(done + 1, total + 1))
  return {
    total: mine.length + 1,
    failed,
    reason,
    skipped: others.length,
    otherOwners: [...new Set(others.map((f) => f.owners?.[0]?.emailAddress).filter((x): x is string => !!x))],
  }
}

// ---- Receiver -----------------------------------------------------------------

export interface IncomingTransfer {
  manifestId: string
  manifest: TransferManifest
}

/** Transfers sent to the signed-in account and not accepted yet. */
export async function findIncoming(): Promise<IncomingTransfer[]> {
  const me = (await about()).email.toLowerCase()
  const out: IncomingTransfer[] = []
  const q = `(name = '${TRANSFER_FILE_NAME}' or name = '${PEOPLE_FILE_NAME}') and trashed = false and not 'me' in owners`
  await listFiles(q, async (files) => {
    for (const f of files) {
      try {
        const manifest = JSON.parse(await downloadText(f.id)) as TransferManifest
        if (manifest.format === 'mymedia-transfer' && manifest.to === me) out.push({ manifestId: f.id, manifest })
      } catch {
        // not readable: ignore
      }
    }
  }, undefined, 'id,name')
  // People last: their photos must be here first.
  return out.sort((a, b) => Number(a.manifest.kind === 'people') - Number(b.manifest.kind === 'people'))
}

/** Moves the content of `from` into `to`, merging folders that have the same name. */
async function mergeInto(from: string, to: string): Promise<void> {
  const existing = new Map<string, string>()
  await listFiles(childrenQuery([to]), (files) => {
    for (const f of files) if (f.mimeType === FOLDER_MIME) existing.set(f.name.toLocaleLowerCase(), f.id)
  }, undefined, 'id,name,mimeType')
  const children: DriveFile[] = []
  await listFiles(childrenQuery([from]), (files) => void children.push(...files), undefined, 'id,name,mimeType')
  for (const c of children) {
    // The sender's own MyMedia files stay theirs (only possible for "everything").
    if (isMyMediaFile(c)) continue
    const same = c.mimeType === FOLDER_MIME ? existing.get(c.name.toLocaleLowerCase()) : undefined
    if (same) await mergeInto(c.id, same)
    else await moveFile(c.id, to, from)
  }
  await trashFile(from)
}

/** Accepts every item, puts the folder in MyMedia and takes the metadata. Returns the number of items that failed. */
export async function acceptTransfer(t: IncomingTransfer, onProgress: Progress): Promise<TransferResult> {
  const rootId = app().rootId!
  const { manifest } = t
  const permissionId = await step('accept', myPermissionId)
  if (manifest.kind === 'people') return acceptPeople(t, permissionId)
  const inside = await step('accept', () => walk(manifest.folderId))
  const all = [{ id: manifest.folderId }, ...inside]
  // Folders first (top down), so the files land in folders already ours.
  const { failed, reason } = await each(all, (f) => acceptOwnership(f.id, permissionId), onProgress)
  const top = await step('accept', () => getFile(manifest.folderId, 'id,ownedByMe'))
  if (!top.ownedByMe) throw new TransferError('accept', reason ?? 'folder not accepted')

  await step('move', async () => {
    // Same place as in the sender's MyMedia: create the parents, merge with a folder of the same name.
    if (!manifest.path.length) {
      // Everything: its categories join this MyMedia's (same names merged), its unsorted photos its root.
      await trashFile(t.manifestId).catch(() => undefined)
      await mergeInto(manifest.folderId, rootId)
      return
    }
    let parent = rootId
    for (const name of manifest.path.slice(0, -1)) {
      parent = (await folderNamed(name, parent)).id
    }
    const last = manifest.path[manifest.path.length - 1]
    const same = await findFolderNamed(parent, last, manifest.folderId)
    await trashFile(t.manifestId).catch(() => undefined)
    if (same && same.id !== manifest.folderId) {
      await moveInto(manifest.folderId, parent)
      await mergeInto(manifest.folderId, same.id)
    } else {
      await moveInto(manifest.folderId, parent)
    }
  })

  // What the sender's MyMedia knew about each photo.
  await syncNow()
  const d = db()
  const now = Date.now()
  for (const [id, sent] of Object.entries(manifest.items)) {
    const cur = await d.meta.get(id)
    if (!cur) continue
    await d.meta.put({ ...sent, id, name: cur.name, category: cur.category, album: cur.album, deleted: undefined, updatedAt: now })
  }
  await markMetaDirty()
  if (manifest.faces) await importFaces(manifest.faces)
  return { total: all.length, failed, reason, skipped: 0, otherOwners: [] }
}

async function acceptPeople(t: IncomingTransfer, permissionId: string): Promise<TransferResult> {
  await syncNow()
  const n = await step('accept', () => importFaces(t.manifest.faces ?? { persons: [], faces: [] }))
  // None of the photos here yet (their transfer not accepted): kept for later.
  if (!n) throw new TransferError('peopleNotYet', '')
  await acceptOwnership(t.manifestId, permissionId).catch(() => undefined)
  await trashFile(t.manifestId).catch(() => undefined)
  return { total: n, failed: 0, skipped: 0, otherOwners: [] }
}

// ---- People of photos given before --------------------------------------------

/** Sends to `email` who is on the photos given before people went with them. Returns the number of photos. */
export async function sendPeople(email: string): Promise<number> {
  const rootId = app().rootId!
  const faces = await facesOfGivenMedia()
  if (!faces.faces.length) throw new TransferError('peopleNone', '')
  const me = await about()
  const manifest: TransferManifest = {
    format: 'mymedia-transfer',
    version: 1,
    from: me.email,
    to: email.trim().toLowerCase(),
    folderId: rootId,
    path: [],
    createdAt: Date.now(),
    items: {},
    faces,
    kind: 'people',
  }
  await step('send', async () => {
    const old = await findChildByName(rootId, PEOPLE_FILE_NAME)
    if (old) await trashFile(old.id).catch(() => undefined)
    const file = await createTextFile(PEOPLE_FILE_NAME, rootId, JSON.stringify(manifest))
    await offerOwnership(file.id, manifest.to, false)
  })
  return new Set(faces.faces.map((f) => f.mediaId)).size
}
