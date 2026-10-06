// Classification rules, in order:
//   1. location (the folder) — media already in an album are classified;
//   2. a meaningful file name equal to an album name;
//   3. the learned model (nearest examples): auto-move when confident,
//      otherwise a suggestion; below the medium threshold it is "To check".
// User decisions always win (keepHere, manual moves, corrections).

import { db, type MediaRecord } from '../db/db'
import { moveFile } from '../drive/api'
import { meaningfulName, nameKey } from '../lib/filename'
import type { MediaMeta } from '../lib/metadata'
import { placementOf } from '../lib/tree'
import { calibrateTau, predictMany } from '../ml/ml'
import type { PackedSet } from '../ml/protocol'
import { app } from '../store'
import { markMetaDirty } from '../sync/metaStore'
import { albumsUnder, allowedFor, isCandidate, labeledSet, loadData, type ClassifyData } from './data'

let running: Promise<void> | null = null

async function tauFor(set: PackedSet): Promise<number> {
  const d = db()
  const cached = await d.getKv<{ tau: number; n: number }>('tau')
  if (cached && Math.abs(cached.n - set.ids.length) <= Math.max(5, set.ids.length * 0.05)) return cached.tau
  const tau = await calibrateTau(set)
  await d.setKv('tau', { tau, n: set.ids.length })
  return tau
}

/** Moves a media to another folder in Drive and records how it was classified. */
export async function moveMedia(rec: MediaRecord, toFolderId: string, patch: Partial<MediaMeta>): Promise<void> {
  const rootId = app().rootId!
  if (toFolderId !== rec.folderId) await moveFile(rec.id, toFolderId, rec.folderId)
  const d = db()
  const folders = new Map((await d.folders.toArray()).map((f) => [f.id, f]))
  const place = placementOf(toFolderId, folders, rootId)
  await d.media.update(rec.id, { folderId: toFolderId })
  const cur = await d.meta.get(rec.id)
  if (cur) {
    await d.meta.put({
      ...cur,
      category: place.category,
      album: place.album,
      suggestions: undefined,
      toCheck: false,
      keepHere: undefined,
      ...patch,
      updatedAt: Date.now(),
    })
  }
  await markMetaDirty()
}

async function patchMeta(id: string, patch: Partial<MediaMeta>) {
  const d = db()
  const cur = await d.meta.get(id)
  if (cur) await d.meta.put({ ...cur, ...patch, updatedAt: Date.now() })
}

function sameSuggestions(a: MediaMeta['suggestions'], b: MediaMeta['suggestions']): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

async function run(): Promise<void> {
  const rootId = app().rootId
  if (!rootId) return
  const settings = app().settings
  const data = await loadData(rootId)
  const candidates = data.media.filter((r) => isCandidate(r, data))
  if (!candidates.length) return
  let changed = false

  // 2. File names that match an album.
  const remaining: MediaRecord[] = []
  for (const rec of candidates) {
    const text = meaningfulName(rec.name)
    const meta = data.meta.get(rec.id)
    if (text) {
      const key = nameKey(text)
      const pool = rec.folderId === rootId ? [...data.folders.values()] : albumsUnder(rec.folderId, data)
      const match = pool.find((f) => nameKey(f.name) === key && f.id !== rootId)
      if (match) {
        await moveMedia(rec, match.id, { source: 'filename', confidence: 1, auto: false })
        continue
      }
      if (meta && !meta.description) {
        await patchMeta(rec.id, { description: text })
        changed = true
      }
    }
    remaining.push(rec)
  }

  // 3. Learned model.
  const { set, counts } = labeledSet(data)
  const queries = remaining.filter((r) => data.vecs.has(r.id))
  if (queries.length && counts.size >= 2) {
    const tau = await tauFor(set)
    const preds = await predictMany(
      set,
      queries.map((r) => ({ id: r.id, vec: data.vecs.get(r.id)!, allowed: allowedFor(r, data) })),
      tau,
    )
    for (let i = 0; i < queries.length; i++) {
      const rec = queries[i]
      const top = preds[i][0]
      if (!top) continue
      const examples = counts.get(top.label) ?? 0
      if (settings.classifyAuto && top.confidence >= settings.thresholdHigh && examples >= 3) {
        await moveMedia(rec, top.label, { source: 'model', confidence: top.confidence, auto: true })
        continue
      }
      const suggestions = preds[i].map((p) => ({ folderId: p.label, confidence: Math.round(p.confidence * 1000) / 1000 }))
      const toCheck = top.confidence < settings.thresholdMedium
      const meta = data.meta.get(rec.id)
      if (meta && (!sameSuggestions(meta.suggestions, suggestions) || !!meta.toCheck !== toCheck)) {
        await patchMeta(rec.id, { suggestions, toCheck, confidence: top.confidence })
        changed = true
      }
    }
  }
  if (changed) await markMetaDirty()
}

/** Classifies the media waiting at the root or in a category. Concurrent calls share one run. */
export function classifyPending(): Promise<void> {
  running ??= run()
    .catch((e) => console.error('[MyMedia] classification failed', e))
    .finally(() => {
      running = null
    })
  return running
}

// ---- User decisions ---------------------------------------------------------

async function record(id: string): Promise<MediaRecord> {
  const rec = await db().media.get(id)
  if (!rec) throw new Error('media not found')
  return rec
}

/** The user picks a destination (one of the suggestions or any album). */
export async function chooseFolder(id: string, folderId: string): Promise<void> {
  const meta = await db().meta.get(id)
  const top = meta?.suggestions?.[0]
  const fromModel = top?.folderId === folderId
  await moveMedia(await record(id), folderId, {
    source: fromModel ? 'model' : 'manual',
    confidence: fromModel ? top!.confidence : null,
    auto: false,
  })
}

/** The media stays where it is: no more suggestions for it. */
export async function keepHere(id: string): Promise<void> {
  await patchMeta(id, { keepHere: true, suggestions: undefined, toCheck: false, source: 'manual' })
  await markMetaDirty()
}

/** An automatic move was right. */
export async function confirmAuto(ids: string[]): Promise<void> {
  for (const id of ids) await patchMeta(id, { auto: false })
  await markMetaDirty()
}

/** Accepts every first suggestion at or above the medium threshold. */
export async function acceptConfident(ids: string[]): Promise<number> {
  const d = db()
  const min = app().settings.thresholdMedium
  let n = 0
  for (const id of ids) {
    const top = (await d.meta.get(id))?.suggestions?.[0]
    if (top && top.confidence >= min) {
      await chooseFolder(id, top.folderId)
      n++
    }
  }
  return n
}

export type { ClassifyData }
