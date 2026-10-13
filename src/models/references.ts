// Classification models: the fingerprints of another account's sorted photos,
// used as extra examples (no photo is copied).
//
// Seller: `buildModel` packs the examples of one category for the shop.
// Buyer: `installModel` creates the albums and keeps the model in a
// mymedia-model-<id>.json file of their Drive, so every device of the account
// uses it. It is used only by the account it was bought for, and only while
// the server says the licence is valid.

import { db } from '../db/db'
import { createFolder, createTextFile, downloadText, findChildByName, folderNamed, listFiles, sameFolderName, trashFile, updateTextFile, type DriveFile } from '../drive/api'
import { nameKey } from '../lib/filename'
import { FOLDER_MIME } from '../lib/media'
import { albumsUnder, labeledSet, loadData, type ClassifyData } from '../classify/data'
import { folderChain } from '../lib/tree'
import { EMBED_DIM, MODEL_ID } from '../ml/protocol'
import { app } from '../store'
import { syncNow } from '../sync/engine'
import { checkLicence, downloadModel, ShopError, type ModelData, type PublishInput } from './shop'

const FILE_PREFIX = 'mymedia-model-'
const SEP = ' / '
const MAX_EXAMPLES = 4000
const PER_ALBUM = 60
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
  /** The account the model was bought for. */
  buyer: string
  model: string
  dim: number
  /** Album paths under the category, with the folder made for each (renames keep it). */
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

/** The folder of an album of the model in this account, or null (album deleted). */
function albumFolder(m: InstalledModel, k: number, data: ClassifyData): string | null {
  const a = m.albums[k]
  if (a.folderId && data.folders.has(a.folderId)) return a.folderId
  let parent: string | undefined = [...data.folders.values()].find((f) => f.parentId === data.rootId && sameFolderName(f.name, m.category))?.id
  for (const name of a.path.split(SEP)) {
    if (!parent) return null
    const p: string = parent
    parent = [...data.folders.values()].find((f) => f.parentId === p && sameFolderName(f.name, name))?.id
  }
  return parent ?? null
}

/** The examples the installed models add to this account's own. */
export async function referenceExamples(data: ClassifyData): Promise<{ ids: string[]; labels: string[]; vecs: Int8Array[] }> {
  const out = { ids: [] as string[], labels: [] as string[], vecs: [] as Int8Array[] }
  for (const m of await installedModels()) {
    if (m.model !== MODEL_ID || m.dim !== EMBED_DIM || !(await licensed(m))) continue
    const folders = m.albums.map((_, k) => albumFolder(m, k, data))
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

export type InstallStep = 'download' | 'albums' | 'save' | 'sync'
export type InstallProgress = (step: InstallStep, done: number, total: number) => void

/**
 * Folders found or created by name, each Drive folder listed once and
 * several albums created at a time (101 albums one by one took minutes).
 */
function folderMaker() {
  const lists = new Map<string, Promise<DriveFile[]>>()
  const made = new Map<string, Promise<string>>()
  const listOf = (parent: string) => {
    let p = lists.get(parent)
    if (!p) {
      p = (async () => {
        const out: DriveFile[] = []
        await listFiles(`'${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`, (page) => void out.push(...page), undefined, 'id,name')
        return out
      })()
      lists.set(parent, p)
    }
    return p
  }
  return (name: string, parent: string): Promise<string> => {
    const key = `${parent}\n${nameKey(name) || name}`
    let p = made.get(key)
    if (!p) {
      p = (async () => (await listOf(parent)).find((f) => sameFolderName(f.name, name))?.id ?? (await createFolder(name, parent)).id)()
      made.set(key, p)
    }
    return p
  }
}

/** Gets the model (the licence is there already) and creates its albums (then classify again). */
export async function installModel(id: string, onProgress: InstallProgress = () => undefined): Promise<InstalledModel> {
  const rootId = app().rootId
  if (!rootId) throw new ModelError('noRoot')
  onProgress('download', 0, 1)
  const { info, buyer, data } = await downloadModel(id)
  if (data.model !== MODEL_ID || data.dim !== EMBED_DIM) throw new ModelError('otherModel')
  const folderIn = folderMaker()
  const category = await folderNamed(info.category, rootId)
  const albums: InstalledModel['albums'] = data.albums.map((path) => ({ path, folderId: null }))
  let done = 0
  let next = 0
  onProgress('albums', 0, albums.length)
  const worker = async () => {
    while (next < albums.length) {
      const a = albums[next++]
      let parent = category.id
      for (const name of a.path.split(SEP)) parent = await folderIn(name, parent)
      a.folderId = parent
      onProgress('albums', ++done, albums.length)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  const m: InstalledModel = {
    format: 'mymedia-model',
    version: 1,
    id,
    name: info.name,
    seller: info.seller,
    category: info.category,
    buyer,
    model: data.model,
    dim: data.dim,
    albums,
    labels: data.labels,
    vecs: data.vecs,
  }
  onProgress('save', 0, 1)
  const existing = await findChildByName(rootId, fileName(id))
  if (existing) await updateTextFile(existing.id, JSON.stringify(m))
  else await createTextFile(fileName(id), rootId, JSON.stringify(m))
  try {
    localStorage.setItem(licenceKey(id, buyer), String(Date.now()))
  } catch {
    // ignore
  }
  cache = null
  onProgress('sync', 0, 1)
  await syncNow()
  return m
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
