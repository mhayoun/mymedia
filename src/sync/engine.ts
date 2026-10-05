// Drive ⇄ local cache synchronisation.
// First run: one full scan of the root tree. Afterwards: Drive Changes API only.

import { db, openDb, type MediaRecord } from '../db/db'
import {
  about,
  childrenQuery,
  createFolder,
  DriveError,
  findFolderInMyDrive,
  getFile,
  getStartPageToken,
  listChanges,
  listFiles,
  type DriveFile,
} from '../drive/api'
import { auth } from '../auth/google'
import { planChanges } from '../lib/changes'
import { dateFromFileName, detectOrigin, FOLDER_MIME, mediaTypeOf, parseExifDate } from '../lib/media'
import type { MediaMeta } from '../lib/metadata'
import { placementOf, subtreeIds, type FolderNode } from '../lib/tree'
import { app } from '../store'
import { markMetaDirty, pullMeta, saveMeta } from './metaStore'

const PARENTS_PER_QUERY = 25

export class SyncCancelled extends Error {}

let running: Promise<void> | null = null
let abort: AbortController | null = null

function toRecord(f: DriveFile): MediaRecord | null {
  const type = mediaTypeOf(f.mimeType, f.name)
  const folderId = f.parents?.[0]
  if (!type || !folderId) return null
  const img = f.imageMediaMetadata
  const vid = f.videoMediaMetadata
  const created = f.createdTime ?? new Date().toISOString()
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    type,
    folderId,
    size: Number(f.size ?? 0),
    md5: f.md5Checksum,
    createdTime: created,
    modifiedTime: f.modifiedTime ?? created,
    takenAt: parseExifDate(img?.time) ?? dateFromFileName(f.name) ?? created,
    width: img?.width ?? vid?.width,
    height: img?.height ?? vid?.height,
    durationMs: vid?.durationMillis ? Number(vid.durationMillis) : undefined,
    cameraMake: img?.cameraMake,
    cameraModel: img?.cameraModel,
    thumbnailLink: f.thumbnailLink,
    webViewLink: f.webViewLink,
    appProperties: f.appProperties,
  }
}

function toFolder(f: DriveFile): FolderNode {
  return { id: f.id, name: f.name, parentId: f.parents?.[0] ?? '' }
}

/** Signs in the Drive user, opens their local database. */
export async function loadUser(): Promise<void> {
  const user = await about()
  auth.loginHint = user.email
  const d = openDb(user.email)
  await d.setKv('user', user)
  app().set({ user })
}

/** Opens the cached database of the last account, for offline / instant start. */
export async function openCachedUser(email: string): Promise<boolean> {
  const d = openDb(email)
  const user = await d.getKv<{ email: string; name: string; photo?: string }>('user')
  const rootId = await d.getKv<string>('rootId')
  if (!user || !rootId) return false
  app().set({ user, rootId })
  return true
}

/** Finds the root folder. Returns false when it does not exist yet. */
export async function locateRoot(): Promise<'found' | 'missing' | 'removed'> {
  const d = db()
  const known = await d.getKv<string>('rootId')
  if (known) {
    try {
      const f = await getFile(known, 'id,name,trashed')
      if (!f.trashed) {
        app().set({ rootId: known })
        if (f.name !== app().settings.rootName) app().updateSettings({ rootName: f.name })
        return 'found'
      }
    } catch (e) {
      if (!(e instanceof DriveError && e.status === 404)) throw e
    }
    await resetIndex()
    const again = await findFolderInMyDrive(app().settings.rootName)
    if (!again) return 'removed'
    await setRoot(again.id)
    return 'found'
  }
  const found = await findFolderInMyDrive(app().settings.rootName)
  if (!found) return 'missing'
  await setRoot(found.id)
  return 'found'
}

async function setRoot(id: string) {
  await db().setKv('rootId', id)
  app().set({ rootId: id })
}

async function resetIndex() {
  const d = db()
  await d.transaction('rw', [d.media, d.folders, d.kv], async () => {
    await d.media.clear()
    await d.folders.clear()
    await d.kv.bulkDelete(['rootId', 'pageToken', 'metaFileId'])
  })
}

/** Creates the root folder and the chosen categories. */
export async function createRoot(name: string, categories: string[]): Promise<void> {
  const root = await createFolder(name, 'root')
  for (const c of categories) await createFolder(c, root.id)
  await resetIndex()
  await setRoot(root.id)
  app().updateSettings({ rootName: name })
}

/** Scans folderIds and everything below them. */
async function scanTrees(
  folderIds: string[],
  signal: AbortSignal,
  onCount: (folders: number, files: number) => void,
): Promise<{ folders: FolderNode[]; media: MediaRecord[] }> {
  const folders: FolderNode[] = []
  const media: MediaRecord[] = []
  let queue = [...folderIds]
  while (queue.length) {
    const batch = queue.slice(0, PARENTS_PER_QUERY)
    queue = queue.slice(PARENTS_PER_QUERY)
    await listFiles(
      childrenQuery(batch),
      (files) => {
        for (const f of files) {
          if (f.mimeType === FOLDER_MIME) {
            folders.push(toFolder(f))
            queue.push(f.id)
          } else {
            const r = toRecord(f)
            if (r) media.push(r)
          }
        }
        onCount(folders.length, media.length)
      },
      signal,
    )
  }
  return { folders, media }
}

async function fullScan(rootId: string, signal: AbortSignal) {
  // Token first: changes made during the scan are picked up next time.
  const pageToken = await getStartPageToken()
  app().set({ sync: { step: 'sync.scanning', done: 0, total: 0 } })
  const { folders, media } = await scanTrees([rootId], signal, (_f, files) =>
    app().set({ sync: { step: 'sync.scanning', done: files, total: 0 } }),
  )
  signal.throwIfAborted()
  const d = db()
  await d.transaction('rw', [d.media, d.folders, d.kv], async () => {
    await d.media.clear()
    await d.folders.clear()
    await d.folders.bulkPut(folders)
    await d.media.bulkPut(media)
    await d.setKv('pageToken', pageToken)
  })
}

async function applyChanges(rootId: string, signal: AbortSignal) {
  const d = db()
  const pageToken = await d.getKv<string>('pageToken')
  if (!pageToken) return fullScan(rootId, signal)
  app().set({ sync: { step: 'sync.checking', done: 0, total: 0 } })
  const { changes, newStartPageToken } = await listChanges(pageToken, signal)
  if (changes.length === 0) {
    await d.setKv('pageToken', newStartPageToken)
    return
  }
  const allFolders = await d.folders.toArray()
  const knownFolders = new Set([rootId, ...allFolders.map((f) => f.id)])
  const knownMedia = new Set(await d.media.toCollection().primaryKeys())
  const plan = planChanges(
    changes.map((c) => ({ fileId: c.fileId, removed: c.removed, file: c.file })),
    rootId,
    knownFolders,
    knownMedia,
  )
  if (plan.rootRemoved) {
    app().set({ phase: 'rootMissing' })
    return
  }
  const total = changes.length
  app().set({ sync: { step: 'sync.applying', done: 0, total } })

  // Folders that entered the tree may already contain files.
  const scanned = plan.scanFolders.length
    ? await scanTrees(plan.scanFolders, signal, (_f, files) =>
        app().set({ sync: { step: 'sync.applying', done: Math.min(files, total), total } }),
      )
    : { folders: [], media: [] }
  signal.throwIfAborted()

  const folderMap = new Map(allFolders.map((f) => [f.id, f]))
  const removedFolderIds = new Set<string>()
  for (const id of plan.removeFolders) for (const sub of subtreeIds(id, folderMap.values())) removedFolderIds.add(sub)

  const upsertMedia = [...scanned.media, ...plan.upsertMedia.map((f) => toRecord(f as DriveFile))].filter(
    (r): r is MediaRecord => r !== null,
  )
  await d.transaction('rw', [d.media, d.folders, d.kv], async () => {
    if (removedFolderIds.size) {
      await d.folders.bulkDelete([...removedFolderIds])
      await d.media.where('folderId').anyOf([...removedFolderIds]).delete()
    }
    await d.folders.bulkPut([...plan.upsertFolders.map((f) => toFolder(f as DriveFile)), ...scanned.folders])
    await d.media.bulkDelete(plan.removeMedia)
    await d.media.bulkPut(upsertMedia)
    await d.setKv('pageToken', newStartPageToken)
  })
  app().set({ sync: { step: 'sync.applying', done: total, total } })
}

/**
 * Keeps mymedia.json in line with Drive: every media has an entry, category
 * and album always follow the folder (the main classification rule), and
 * removed media become tombstones.
 */
async function reconcileMeta(rootId: string) {
  const d = db()
  const [media, folders, metas] = await Promise.all([d.media.toArray(), d.folders.toArray(), d.meta.toArray()])
  const folderMap = new Map(folders.map((f) => [f.id, f]))
  const metaMap = new Map(metas.map((m) => [m.id, m]))
  const now = Date.now()
  const changed: MediaMeta[] = []

  for (const r of media) {
    const p = placementOf(r.folderId, folderMap, rootId)
    const cur = metaMap.get(r.id)
    metaMap.delete(r.id)
    if (!cur || cur.deleted) {
      const folderPath = [p.category, p.album].filter(Boolean).join('/')
      changed.push({
        id: r.id,
        name: r.name,
        type: r.type,
        takenAt: r.takenAt,
        origin: detectOrigin({ name: r.name, type: r.type, cameraMake: r.cameraMake, cameraModel: r.cameraModel, folderPath }),
        category: p.category,
        album: p.album,
        source: 'folder',
        updatedAt: now,
      })
      continue
    }
    if (cur.name !== r.name || cur.category !== p.category || cur.album !== p.album) {
      changed.push({ ...cur, name: r.name, category: p.category, album: p.album, updatedAt: now })
    }
  }
  // Whatever is left is no longer in Drive.
  for (const m of metaMap.values()) {
    if (!m.deleted) changed.push({ ...m, deleted: true, updatedAt: now })
  }
  if (changed.length) {
    await d.meta.bulkPut(changed)
    await markMetaDirty()
  }
}

/** Loads new and modified files. Safe to call often: concurrent calls share one run. */
export function syncNow(options: { full?: boolean } = {}): Promise<void> {
  if (running) return running
  const rootId = app().rootId
  if (!rootId) return Promise.resolve()
  abort = new AbortController()
  const signal = abort.signal
  running = (async () => {
    try {
      app().set({ error: null })
      if (options.full) await fullScan(rootId, signal)
      else await applyChanges(rootId, signal)
      if (app().phase === 'rootMissing') return
      app().set({ sync: { step: 'sync.metadata', done: 0, total: 0 } })
      await pullMeta(rootId)
      await reconcileMeta(rootId)
      await saveMeta()
      app().set({ lastSyncAt: Date.now() })
    } catch (e) {
      if (signal.aborted) return
      console.error('[MyMedia] sync failed', e)
      if (!app().error) app().set({ error: 'errors.syncFailed' })
    } finally {
      app().set({ sync: null })
      running = null
      abort = null
    }
  })()
  return running
}

export function cancelSync() {
  abort?.abort(new SyncCancelled())
}

export function isSyncing(): boolean {
  return running !== null
}
