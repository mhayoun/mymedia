// Classification models: the fingerprints of another account's sorted photos,
// used as extra examples (no photo is copied).
//
// Seller: `buildModel` packs the examples of one category for the shop.
// Buyer: `installModel` keeps the model in a mymedia-model-<id>.json file of
// their Drive, so every device of the account uses it. Its albums are created
// only when a first photo goes into one (`ensureAlbum`), not at install. It is used only by the account it was bought for, and only while
// the server says the licence is valid.

import { db } from '../db/db'
import { createTextFile, downloadText, findChildByName, folderNamed, listFiles, sameFolderName, trashFile, updateTextFile } from '../drive/api'
import { albumsUnder, labeledSet, loadData, type ClassifyData } from '../classify/data'
import { folderChain, parsePendingAlbum, pendingAlbumId, type FolderNode } from '../lib/tree'
import { EMBED_DIM, MODEL_ID } from '../ml/protocol'
import { app } from '../store'
import { syncNow } from '../sync/engine'
import { checkLicence, downloadModel, ShopError, type ModelData, type PublishInput } from './shop'

const FILE_PREFIX = 'mymedia-model-'
const SEP = ' / '
// As the shop takes (api/models.ts): with 100 albums, 56 photos each.
const MAX_EXAMPLES = 5600
const PER_ALBUM = 200
/** A licence confirmed by the server is trusted that long without asking again (offline use). */
const LICENCE_TTL_MS = 3 * 24 * 3600 * 1000

/** A model as kept in the buyer's Drive. */
export interface InstalledModel {
  format: 'mymedia-model'
  version: 1
  id: string
  name: string
  seller: string
  category: string
  /** The category folder in the buyer's Drive (renames keep it). Missing in older files. */
  categoryId?: string
  /** The account the model was bought for. */
  buyer: string
  model: string
  dim: number
  /** Album paths under the category, with its folder once there is one (renames keep it). */
  albums: { path: string; folderId: string | null }[]
  labels: number[]
  vecs: string
}

export class ModelError extends Error {
  code: 'otherModel' | 'tooFew' | 'noRoot'
  constructor(code: ModelError['code']) {
    super(code)
    this.code = code
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text: string): Int8Array {
  const s = atob(text)
  const out = new Int8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) << 24 >> 24
  return out
}

const fileName = (id: string) => `${FILE_PREFIX}${id}.json`

// ---- Seller -------------------------------------------------------------------

/** The examples of a category (its albums' sorted photos), ready to publish. */
export async function buildModel(categoryId: string): Promise<Pick<PublishInput, keyof ModelData | 'category'> & { photos: number; left: string[] }> {
  const rootId = app().rootId
  if (!rootId) throw new ModelError('noRoot')
  const data = await loadData(rootId)
  const { set } = labeledSet(data)
  const byAlbum = new Map<string, number[]>()
  set.labels.forEach((folderId, i) => {
    if (folderId === categoryId) return
    const chain = folderChain(folderId, data.folders, rootId)
    if (!chain?.some((f) => f.id === categoryId)) return
    byAlbum.set(folderId, [...(byAlbum.get(folderId) ?? []), i])
  })
  if (byAlbum.size < 2) throw new ModelError('tooFew')
  const total = [...byAlbum.values()].reduce((n, l) => n + l.length, 0)
  const cap = Math.max(5, Math.min(PER_ALBUM, Math.floor(MAX_EXAMPLES / byAlbum.size)))
  const albums: string[] = []
  const labels: number[] = []
  const picked: number[] = []
  for (const [folderId, list] of byAlbum) {
    const chain = folderChain(folderId, data.folders, rootId)!
    const below = chain.slice(chain.findIndex((f) => f.id === categoryId) + 1)
    albums.push(below.map((f) => f.name).join(SEP))
    // Spread over the album, not only its first photos.
    const step = list.length / Math.min(cap, list.length)
    for (let k = 0; k < Math.min(cap, list.length); k++) {
      picked.push(list[Math.floor(k * step)])
      labels.push(albums.length - 1)
    }
  }
  const vecs = new Uint8Array(picked.length * EMBED_DIM)
  picked.forEach((i, k) => vecs.set(new Uint8Array(set.data.buffer, set.data.byteOffset + i * EMBED_DIM, EMBED_DIM), k * EMBED_DIM))
  return {
    category: data.folders.get(categoryId)?.name ?? '',
    model: MODEL_ID,
    dim: EMBED_DIM,
    albums,
    labels,
    vecs: toBase64(vecs),
    photos: total,
    // Albums without any example: empty, not analysed yet, or only automatic moves not checked yet.
    left: albumsUnder(categoryId, data)
      .filter((f) => !byAlbum.has(f.id) && !albumsUnder(f.id, data).length)
      .map((f) => f.name),
  }
}

// ---- Buyer --------------------------------------------------------------------

let cache: Promise<InstalledModel[]> | null = null

function licenceKey(id: string, email: string) {
  return `mymedia.licence.${id}.${email}`
}

/** The models kept in this account's Drive. */
export function installedModels(): Promise<InstalledModel[]> {
  cache ??= (async () => {
    const rootId = app().rootId
    if (!rootId || !navigator.onLine) return (await db().getKv<InstalledModel[]>('models')) ?? []
    const files: { id: string; name: string }[] = []
    await listFiles(
      `'${rootId}' in parents and name contains '${FILE_PREFIX}' and trashed = false`,
      (page) => void files.push(...page),
      undefined,
      'id,name',
    )
    const out: InstalledModel[] = []
    for (const f of files) {
      try {
        const m = JSON.parse(await downloadText(f.id)) as InstalledModel
        if (m.format === 'mymedia-model') out.push(m)
      } catch (e) {
        console.warn('[MyMedia] model file unreadable', f.name, e)
      }
    }
    await db().setKv('models', out)
    return out
  })().catch(async (e) => {
    console.warn('[MyMedia] models not read', e)
    cache = null
    return (await db().getKv<InstalledModel[]>('models')) ?? []
  })
  return cache
}

/** Whether this account may use the model: bought for it, and the licence is valid. */
async function licensed(m: InstalledModel): Promise<boolean> {
  const email = app().user?.email?.toLowerCase()
  if (!email || m.buyer !== email) return false
  const key = licenceKey(m.id, email)
  let last = 0
  try {
    last = Number(localStorage.getItem(key) ?? 0)
  } catch {
    // no storage: ask the server
  }
  if (Date.now() - last < LICENCE_TTL_MS) return true
  if (!navigator.onLine) return last > 0
  try {
    const r = await checkLicence(m.id)
    try {
      if (r.ok) localStorage.setItem(key, String(Date.now()))
      else localStorage.removeItem(key)
    } catch {
      // ignore
    }
    return r.ok
  } catch (e) {
    // Server out of reach: a licence seen before stays valid.
    return !(e instanceof ShopError) && last > 0
  }
}

/** The model's category in this account (found by name if it has no id yet, or it was replaced). */
function categoryOf(m: InstalledModel, folders: ReadonlyMap<string, FolderNode>, rootId: string): string | null {
  const own = m.categoryId ? folders.get(m.categoryId) : undefined
  if (own?.parentId === rootId) return own.id
  return [...folders.values()].find((f) => f.parentId === rootId && sameFolderName(f.name, m.category))?.id ?? null
}

/** The folder at `path` below `parent` (same names as the user sees them), or null. */
function folderAt(parent: string, path: string[], folders: ReadonlyMap<string, FolderNode>): string | null {
  let at: string | undefined = parent
  for (const name of path) {
    const p: string = at
    at = [...folders.values()].find((f) => f.parentId === p && sameFolderName(f.name, name))?.id
    if (!at) return null
  }
  return at ?? null
}

/**
 * The folder of an album of the model in this account; when it has none yet,
 * a pending id (`pendingAlbumId`), created with the first photo put in it.
 * Null when the category is gone.
 */
function albumFolder(m: InstalledModel, k: number, data: ClassifyData, categoryId: string | null): string | null {
  const a = m.albums[k]
  if (a.folderId && data.folders.has(a.folderId)) return a.folderId
  if (!categoryId) return null
  return folderAt(categoryId, a.path.split(SEP), data.folders) ?? pendingAlbumId(categoryId, a.path)
}

/** Albums of the installed models not created yet, by category: to offer them in the album lists. */
export async function modelAlbumsToCreate(folders: ReadonlyMap<string, FolderNode>, rootId: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const m of await installedModels()) {
    if (m.model !== MODEL_ID) continue
    const categoryId = categoryOf(m, folders, rootId)
    if (!categoryId) continue
    const list = out.get(categoryId) ?? []
    for (const a of m.albums) {
      if (a.folderId && folders.has(a.folderId)) continue
      if (folderAt(categoryId, a.path.split(SEP), folders)) continue
      const id = pendingAlbumId(categoryId, a.path)
      if (!list.includes(id)) list.push(id)
    }
    out.set(categoryId, list)
  }
  return out
}

/** The examples the installed models add to this account's own, and their albums not created yet. */
export async function referenceExamples(
  data: ClassifyData,
): Promise<{ ids: string[]; labels: string[]; vecs: Int8Array[]; pending: Map<string, string[]> }> {
  const out = { ids: [] as string[], labels: [] as string[], vecs: [] as Int8Array[], pending: new Map<string, string[]>() }
  for (const m of await installedModels()) {
    if (m.model !== MODEL_ID || m.dim !== EMBED_DIM || !(await licensed(m))) continue
    const categoryId = categoryOf(m, data.folders, data.rootId)
    const folders = m.albums.map((_, k) => albumFolder(m, k, data, categoryId))
    for (const f of folders) {
      if (!f || !categoryId || !parsePendingAlbum(f)) continue
      const list = out.pending.get(categoryId) ?? []
      if (!list.includes(f)) list.push(f)
      out.pending.set(categoryId, list)
    }
    const all = fromBase64(m.vecs)
    m.labels.forEach((label, i) => {
      const folderId = folders[label]
      if (!folderId) return
      out.ids.push(`model:${m.id}:${i}`)
      out.labels.push(folderId)
      out.vecs.push(all.subarray(i * EMBED_DIM, (i + 1) * EMBED_DIM))
    })
  }
  return out
}

export type InstallStep = 'download' | 'save' | 'sync'
export type InstallProgress = (step: InstallStep, done: number, total: number) => void

/** Gets the model (the licence is there already); its albums come with their first photos (then classify again). */
export async function installModel(id: string, onProgress: InstallProgress = () => undefined): Promise<InstalledModel> {
  const rootId = app().rootId
  if (!rootId) throw new ModelError('noRoot')
  onProgress('download', 0, 1)
  const { info, buyer, data } = await downloadModel(id)
  if (data.model !== MODEL_ID || data.dim !== EMBED_DIM) throw new ModelError('otherModel')
  const category = await folderNamed(info.category, rootId)
  const m: InstalledModel = {
    format: 'mymedia-model',
    version: 1,
    id,
    name: info.name,
    seller: info.seller,
    category: info.category,
    categoryId: category.id,
    buyer,
    model: data.model,
    dim: data.dim,
    // Albums the account has already are found by name when classifying.
    albums: data.albums.map((path) => ({ path, folderId: null })),
    labels: data.labels,
    vecs: data.vecs,
  }
  onProgress('save', 0, 1)
  await saveModel(m)
  try {
    localStorage.setItem(licenceKey(id, buyer), String(Date.now()))
  } catch {
    // ignore
  }
  onProgress('sync', 0, 1)
  await syncNow()
  return m
}

async function saveModel(m: InstalledModel): Promise<void> {
  const rootId = app().rootId!
  const existing = await findChildByName(rootId, fileName(m.id))
  if (existing) await updateTextFile(existing.id, JSON.stringify(m))
  else await createTextFile(fileName(m.id), rootId, JSON.stringify(m))
  cache = null
}

const creating = new Map<string, Promise<string>>()

/**
 * The real folder for a destination: a pending album of a model is created
 * now (with the folders above it), once even when several photos go there
 * together, and remembered in the model so a rename keeps it.
 */
export function ensureAlbum(folderId: string): Promise<string> {
  const pending = parsePendingAlbum(folderId)
  if (!pending) return Promise.resolve(folderId)
  let p = creating.get(folderId)
  if (!p) {
    p = (async () => {
      const d = db()
      let parent = pending.categoryId
      for (const name of pending.path) {
        const f = await folderNamed(name, parent)
        await d.folders.put({ id: f.id, name: f.name, parentId: parent })
        parent = f.id
      }
      rememberAlbum(pending.categoryId, pending.path.join(SEP), parent)
      return parent
    })().finally(() => creating.delete(folderId))
    creating.set(folderId, p)
  }
  return p
}

/** Albums created, written in their model a little later, all at once. */
const toRemember: { categoryId: string; path: string; folderId: string }[] = []
let rememberTimer: ReturnType<typeof setTimeout> | null = null
let remembering: Promise<void> = Promise.resolve()
const REMEMBER_DELAY_MS = 3000

function rememberAlbum(categoryId: string, path: string, folderId: string): void {
  toRemember.push({ categoryId, path, folderId })
  if (rememberTimer) clearTimeout(rememberTimer)
  rememberTimer = setTimeout(() => {
    rememberTimer = null
    remembering = remembering.then(saveRemembered).catch((e) => console.warn('[MyMedia] model albums not remembered', e))
  }, REMEMBER_DELAY_MS)
}

async function saveRemembered(): Promise<void> {
  const list = toRemember.splice(0)
  if (!list.length) return
  const rootId = app().rootId!
  const folders = new Map((await db().folders.toArray()).map((f) => [f.id, f]))
  for (const m of await installedModels()) {
    const categoryId = categoryOf(m, folders, rootId)
    let changed = false
    for (const r of list) {
      if (r.categoryId !== categoryId) continue
      const a = m.albums.find((x) => x.path === r.path)
      if (!a || a.folderId === r.folderId) continue
      a.folderId = r.folderId
      changed = true
    }
    if (changed) await saveModel({ ...m, categoryId: categoryId! })
  }
}

/** Stops using a model (its albums and the photos in them stay). */
export async function removeModel(id: string): Promise<void> {
  const rootId = app().rootId
  if (!rootId) return
  const f = await findChildByName(rootId, fileName(id))
  if (f) await trashFile(f.id)
  cache = null
  await db().setKv('models', (await installedModels()).filter((m) => m.id !== id))
}
