// Builds the learning data from the local cache: which media are examples
// (already in an album) and which are waiting to be classified.

import { db, type MediaRecord } from '../db/db'
import type { MediaMeta } from '../lib/metadata'
import { folderChain, isReservedFolderName, type FolderNode } from '../lib/tree'
import { mediaVersion } from '../ml/indexStore'
import { EMBED_DIM, type PackedSet } from '../ml/protocol'

export interface ClassifyData {
  rootId: string
  folders: Map<string, FolderNode>
  media: MediaRecord[]
  meta: Map<string, MediaMeta>
  vecs: Map<string, Int8Array>
  /** Media already analysed (fingerprint made, or failed), in their current version. */
  analysed: Set<string>
  /** Albums of installed models not created yet, by category (see `pendingAlbumId`). */
  pending?: Map<string, string[]>
}

export async function loadData(rootId: string): Promise<ClassifyData> {
  const d = db()
  const [media, folders, metas, embeddings] = await Promise.all([
    d.media.toArray(),
    d.folders.toArray(),
    d.meta.toArray(),
    d.embeddings.toArray(),
  ])
  const versions = new Map(media.map((m) => [m.id, mediaVersion(m)]))
  const vecs = new Map<string, Int8Array>()
  const analysed = new Set<string>()
  for (const e of embeddings) {
    if (versions.get(e.id) !== e.version) continue
    analysed.add(e.id)
    if (e.vec) vecs.set(e.id, e.vec)
  }
  return {
    rootId,
    folders: new Map(folders.map((f) => [f.id, f])),
    media,
    meta: new Map(metas.map((m) => [m.id, m])),
    vecs,
    analysed,
  }
}

/**
 * Albums with photos not analysed yet: what the model knows of them is
 * incomplete, so a photo that could go there waits (e.g. 45 photos of a
 * species not analysed yet, while a new import is analysed first).
 */
export function albumsNotReady(data: ClassifyData): Set<string> {
  const out = new Set<string>()
  for (const rec of data.media) {
    if (data.analysed.has(rec.id) || rec.folderId === data.rootId || !data.folders.has(rec.folderId)) continue
    if (inReservedFolder(rec.folderId, data) || isCandidate(rec, data)) continue
    out.add(rec.folderId)
  }
  return out
}

/** True for media in "_Originals", "_Inbox"… (never examples, never classified). */
export function inReservedFolder(folderId: string, data: ClassifyData): boolean {
  const chain = folderChain(folderId, data.folders, data.rootId)
  return !!chain?.some((f) => isReservedFolderName(f.name))
}

/** Albums (all levels) below a category. */
export function albumsUnder(categoryId: string, data: ClassifyData): FolderNode[] {
  const out: FolderNode[] = []
  const walk = (parent: string) => {
    for (const f of data.folders.values()) {
      if (f.parentId === parent && !isReservedFolderName(f.name)) {
        out.push(f)
        walk(f.id)
      }
    }
  }
  walk(categoryId)
  return out
}

export function isCategory(folderId: string, data: ClassifyData): boolean {
  return data.folders.get(folderId)?.parentId === data.rootId
}

/** Media at the root, or directly in a category that has albums. */
export function isCandidate(rec: MediaRecord, data: ClassifyData): boolean {
  if (data.meta.get(rec.id)?.keepHere) return false
  if (rec.folderId === data.rootId) return true
  if (inReservedFolder(rec.folderId, data)) return false
  return isCategory(rec.folderId, data) && (albumsUnder(rec.folderId, data).length > 0 || !!data.pending?.get(rec.folderId)?.length)
}

/** Where a candidate may go: any album/category for the root, the category's albums otherwise. */
export function allowedFor(rec: MediaRecord, data: ClassifyData): string[] | null {
  if (rec.folderId === data.rootId) return null
  return [...albumsUnder(rec.folderId, data).map((f) => f.id), ...(data.pending?.get(rec.folderId) ?? [])]
}

/**
 * Examples for learning: every fingerprinted media inside a category or an
 * album, labelled with its folder. Automatic moves not yet reviewed are left
 * out, so a mistake is not learned. `extra`: examples of installed models.
 */
export function labeledSet(
  data: ClassifyData,
  extra?: { ids: string[]; labels: string[]; vecs: Int8Array[] },
): { set: PackedSet; counts: Map<string, number> } {
  const ids: string[] = [...(extra?.ids ?? [])]
  const labels: string[] = [...(extra?.labels ?? [])]
  const vecs: Int8Array[] = [...(extra?.vecs ?? [])]
  const counts = new Map<string, number>()
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
  for (const rec of data.media) {
    const vec = data.vecs.get(rec.id)
    if (!vec || rec.folderId === data.rootId || !data.folders.has(rec.folderId)) continue
    if (inReservedFolder(rec.folderId, data)) continue
    const meta = data.meta.get(rec.id)
    if (meta?.auto) continue
    if (isCategory(rec.folderId, data) && albumsUnder(rec.folderId, data).length > 0 && !meta?.keepHere) continue
    ids.push(rec.id)
    labels.push(rec.folderId)
    vecs.push(vec)
    counts.set(rec.folderId, (counts.get(rec.folderId) ?? 0) + 1)
  }
  const flat = new Int8Array(ids.length * EMBED_DIM)
  vecs.forEach((v, i) => flat.set(v, i * EMBED_DIM))
  return { set: { ids, labels, dim: EMBED_DIM, data: flat }, counts }
}
