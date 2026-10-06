// Background learning: computes the fingerprint of every photo and video
// (newest first), saves them to Drive regularly, then classifies.

import { classifyPending } from '../classify/engine'
import { inReservedFolder, loadData } from '../classify/data'
import { db, type MediaRecord } from '../db/db'
import { app } from '../store'
import { driveThumbnail, localPhotoPreview } from '../sync/thumbs'
import { videoKeyFrames } from '../sync/videoFrame'
import { mediaVersion, pullIndex, saveIndex } from './indexStore'
import { embed } from './ml'

const IMAGE_SIZE = 512
const SAVE_EVERY = 200
const CLASSIFY_EVERY = 100

let running: Promise<void> | null = null
let abort: AbortController | null = null

async function imagesFor(rec: MediaRecord): Promise<Blob[]> {
  if (rec.type === 'video') {
    const frames = await videoKeyFrames(rec, IMAGE_SIZE)
    if (frames.length) return frames
    const thumb = await driveThumbnail(rec, IMAGE_SIZE)
    return thumb ? [thumb] : []
  }
  const img = (await driveThumbnail(rec, IMAGE_SIZE)) ?? (await localPhotoPreview(rec, IMAGE_SIZE))
  return img ? [img] : []
}

async function run(signal: AbortSignal) {
  const rootId = app().rootId
  if (!rootId || !navigator.onLine) return
  const d = db()
  const rebuilding = !!(await d.getKv<boolean>('rebuilding'))
  if (!rebuilding) await pullIndex().catch((e) => console.warn('[MyMedia] index download failed', e))
  const data = await loadData(rootId)
  const existing = new Map((await d.embeddings.toArray()).map((e) => [e.id, e]))
  const todo = data.media
    .filter((m) => !inReservedFolder(m.folderId, data))
    .filter((m) => existing.get(m.id)?.version !== mediaVersion(m))
    .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))
  if (!todo.length) {
    if (rebuilding) await finishRebuild()
    await classifyPending()
    return
  }
  let done = 0
  app().set({ indexing: { done, total: todo.length } })
  for (const rec of todo) {
    if (signal.aborted) break
    let vec: Int8Array | null = null
    try {
      const images = await imagesFor(rec)
      if (images.length) vec = await embed(images)
    } catch (e) {
      console.warn('[MyMedia] fingerprint failed', rec.name, e)
    }
    await d.embeddings.put({ id: rec.id, version: mediaVersion(rec), vec: vec ?? undefined, failed: !vec })
    done++
    app().set({ indexing: { done, total: todo.length } })
    if (vec) await d.setKv('indexDirty', true)
    if (done % CLASSIFY_EVERY === 0) await classifyPending()
    if (done % SAVE_EVERY === 0 && !rebuilding) await saveIndex().catch((e) => console.warn('[MyMedia] index save failed', e))
  }
  if (rebuilding) {
    if (!signal.aborted) await finishRebuild()
  } else await saveIndex().catch((e) => console.warn('[MyMedia] index save failed', e))
  await classifyPending()
}

async function finishRebuild() {
  await saveIndex(true)
  await db().setKv('rebuilding', false)
}

/** Starts (or joins) the background learning. */
export function startIndexer(): Promise<void> {
  if (running) return running
  abort = new AbortController()
  running = run(abort.signal)
    .catch((e) => console.error('[MyMedia] learning failed', e))
    .finally(() => {
      app().set({ indexing: null })
      running = null
      abort = null
    })
  return running
}

/** Pauses until the next sync or app start. */
export function stopIndexer() {
  abort?.abort()
}

/** Forgets all fingerprints on this device and computes them again. */
export async function rebuildIndex(): Promise<void> {
  stopIndexer()
  await running
  const d = db()
  await d.embeddings.clear()
  await d.kv.delete('tau')
  await d.setKv('indexDirty', true)
  await d.setKv('rebuilding', true)
  void startIndexer()
}
