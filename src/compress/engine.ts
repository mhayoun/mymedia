// Compression of media on Drive.
//   automatic: new files found in Drive, bigger than the size set in Settings,
//              origin rules applied (WhatsApp off by default);
//   manual:    "Compress" on a file, an album or a category (any origin).
// The file keeps its Drive id, so album, description and classification stay.

import { db, type MediaRecord } from '../db/db'
import { copyFile, downloadBlob, downloadRange, ensureFolderPath, keepPreviousVersion, uploadNewContent, type DriveFile } from '../drive/api'
import { isJpegMime, planCompression, type Plan, type PlanInput, type SkipReason } from '../lib/compressPlan'
import { estimateJpegQuality } from '../lib/jpeg'
import { placementOf } from '../lib/tree'
import { mediaVersion } from '../ml/indexStore'
import { app } from '../store'
import { toRecord } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'
import { canCompressVideo, compressPhoto, compressVideo } from './media'

const ORIGINALS = '_Originals'
/** Automatic mode also takes files added this long before compression was first enabled. */
const AUTO_LOOKBACK_MS = 2 * 24 * 3600 * 1000

let running: Promise<void> | null = null
let abort: AbortController | null = null

export interface Planned {
  rec: MediaRecord
  plan: Plan
}

async function planInput(rec: MediaRecord): Promise<PlanInput> {
  const meta = await db().meta.get(rec.id)
  return {
    name: rec.name,
    type: rec.type,
    mimeType: rec.mimeType,
    size: rec.size,
    width: rec.width,
    height: rec.height,
    durationMs: rec.durationMs,
    cameraMake: rec.cameraMake,
    cameraModel: rec.cameraModel,
    createdTime: rec.createdTime,
    appProperties: rec.appProperties,
    origin: meta?.origin ?? 'unknown',
  }
}

/** Plans each media; reads the first 64 KB of JPEGs to know their quality. */
export async function planMany(recs: MediaRecord[], mode: 'auto' | 'manual'): Promise<Planned[]> {
  const s = app().settings.compress
  const ctx = { mode, videoSupported: await canCompressVideo(), since: await autoSince() }
  const out: Planned[] = []
  for (const rec of recs) {
    const input = await planInput(rec)
    let plan = planCompression(input, s, ctx)
    const long = Math.max(rec.width ?? 0, rec.height ?? 0)
    const resizing = !!s.maxDimension && long > s.maxDimension
    if (plan.ok && rec.type === 'photo' && isJpegMime(rec.mimeType, rec.name) && !resizing) {
      try {
        input.jpegQuality = estimateJpegQuality(await downloadRange(rec.id, 0, Math.min(rec.size, 65536)))
        plan = planCompression(input, s, ctx)
      } catch {
        // quality unknown: keep the first plan
      }
    }
    out.push({ rec, plan })
  }
  return out
}

async function autoSince(): Promise<string> {
  const d = db()
  let since = await d.getKv<string>('compressSince')
  if (!since) {
    since = new Date(Date.now() - AUTO_LOOKBACK_MS).toISOString()
    await d.setKv('compressSince', since)
  }
  return since
}

async function setCompression(id: string, info: NonNullable<import('../lib/metadata').MediaMeta['compression']>) {
  const d = db()
  const cur = await d.meta.get(id)
  if (cur) await d.meta.put({ ...cur, compression: info, updatedAt: Date.now() })
}

/** Remembers files detected as already compressed (for the "Already compressed" filter). */
async function recordSkips(planned: Planned[]) {
  const reasons: SkipReason[] = ['alreadyCompressed', 'compressedByApp']
  let changed = false
  for (const { rec, plan } of planned) {
    if (plan.ok || !reasons.includes(plan.reason)) continue
    const cur = await db().meta.get(rec.id)
    if (cur?.compression?.status) continue
    await setCompression(rec.id, { status: plan.reason === 'compressedByApp' ? 'compressed' : 'already' })
    changed = true
  }
  if (changed) await markMetaDirty()
}

function outputName(rec: MediaRecord): { name: string; mimeType: string } {
  if (rec.type === 'video') return { name: rec.name.replace(/\.mov$/i, '.mp4'), mimeType: 'video/mp4' }
  return { name: isJpegMime(rec.mimeType, rec.name) ? rec.name : rec.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg' }
}

/** Compresses one media. Returns its new size, or null when it was kept unchanged. */
async function compressOne(rec: MediaRecord, signal: AbortSignal, onFile: (p: number) => void): Promise<number | null> {
  const s = app().settings.compress
  let blob: Blob
  if (rec.type === 'photo') {
    const original = await downloadBlob(rec.id, (p) => onFile(p * 0.4), signal)
    blob = await compressPhoto(rec, original, s)
  } else {
    blob = await compressVideo(rec, s, (p) => onFile(p * 0.8), signal)
  }
  signal.throwIfAborted()

  if (blob.size > rec.size * (1 - s.minGain)) {
    await setCompression(rec.id, { status: 'none', sizeBefore: rec.size, date: new Date().toISOString() })
    await markMetaDirty()
    return null
  }

  const rootId = app().rootId!
  if (s.keepOriginal === 'folder') {
    const folders = new Map((await db().folders.toArray()).map((f) => [f.id, f]))
    const p = placementOf(rec.folderId, folders, rootId)
    const path = [ORIGINALS, ...[p.category, ...(p.album?.split(' / ') ?? [])].filter((x): x is string => !!x)]
    await copyFile(rec.id, rec.name, await ensureFolderPath(rootId, path))
  }

  const { name, mimeType } = outputName(rec)
  const updated: DriveFile = await uploadNewContent(
    rec.id,
    blob,
    {
      name,
      mimeType,
      appProperties: {
        mymedia_compressed: '1',
        mymedia_quality: String(Math.round(s.quality * 100)),
        mymedia_original_size: String(rec.size),
      },
    },
    (p) => onFile(0.5 + p * 0.5),
    signal,
  )
  if (s.keepOriginal === 'both') await keepPreviousVersion(rec.id).catch((e) => console.warn('[MyMedia] keep version failed', e))

  // Same picture: carry the fingerprint over to the new version instead of recomputing it.
  const d = db()
  const fresh = toRecord(updated) ?? { ...rec, size: blob.size, name, mimeType }
  const emb = await d.embeddings.get(rec.id)
  await d.media.put({ ...fresh, folderId: rec.folderId })
  if (emb?.vec) await d.embeddings.put({ ...emb, version: mediaVersion(fresh) })
  // Same picture, same faces: keep them for the new version too.
  if (await d.faceScans.get(rec.id)) {
    await d.faceScans.put({ id: rec.id, version: mediaVersion(fresh) })
    await d.faces.where('mediaId').equals(rec.id).modify({ version: mediaVersion(fresh), updatedAt: Date.now() })
    await d.setKv('facesDirty', true)
  }
  const meta = await d.meta.get(rec.id)
  if (meta) await d.meta.put({ ...meta, name, compression: { status: 'compressed', sizeBefore: rec.size, sizeAfter: blob.size, date: new Date().toISOString() }, updatedAt: Date.now() })
  await markMetaDirty()
  return blob.size
}

export type Outcome = { status: 'done'; after: number } | { status: 'nogain' } | { status: 'error' } | { status: 'pending' }

/** Runs compressions one after another; each file's outcome is published as it finishes. */
function runQueue(items: MediaRecord[]): Promise<{ count: number; saved: number }> {
  let result = { count: 0, saved: 0 }
  const outcome = (id: string, o: Outcome) => app().set({ compressOutcome: { ...app().compressOutcome, [id]: o } })
  for (const rec of items) outcome(rec.id, { status: 'pending' })
  const job = async () => {
    abort = new AbortController()
    const signal = abort.signal
    let done = 0
    for (const rec of items) {
      if (signal.aborted) break
      app().set({ compressing: { done, total: items.length, name: rec.name, fileProgress: 0, saved: result.saved } })
      try {
        const after = await compressOne(rec, signal, (p) =>
          app().set({ compressing: { done, total: items.length, name: rec.name, fileProgress: p, saved: result.saved } }),
        )
        if (after === null) outcome(rec.id, { status: 'nogain' })
        else {
          outcome(rec.id, { status: 'done', after })
          result = { count: result.count + 1, saved: result.saved + rec.size - after }
        }
      } catch (e) {
        if (signal.aborted) break
        console.error('[MyMedia] compression failed', rec.name, e)
        outcome(rec.id, { status: 'error' })
      }
      done++
    }
  }
  const run = (running ?? Promise.resolve()).then(job).finally(() => {
    app().set({ compressing: null })
    abort = null
  })
  running = run.finally(() => {
    if (running === run) running = null
  })
  return run.then(() => result)
}

/** Files proposed at this session and set aside with "Later". */
const later = new Set<string>()

/** New big files worth compressing (automatic rules), not yet decided by the user. */
export async function findRecommendations(): Promise<Planned[]> {
  const s = app().settings.compress
  if (s.autoMode === 'off' || (!s.autoPhotos && !s.autoVideos)) return []
  const d = db()
  const since = await autoSince()
  const candidates = (await d.media.toArray()).filter(
    (m) => m.createdTime >= since && !m.appProperties?.mymedia_compressed && !later.has(m.id),
  )
  const metas = new Map((await d.meta.bulkGet(candidates.map((c) => c.id))).filter(Boolean).map((m) => [m!.id, m!]))
  const fresh = candidates.filter((c) => !metas.get(c.id)?.compression?.status)
  if (!fresh.length) return []
  const planned = await planMany(fresh, 'auto')
  await recordSkips(planned)
  return planned.filter((p) => p.plan.ok)
}

/** After each load from Drive: propose (or, if chosen in Settings, run) compression of new big files. */
export async function afterLoadCompression(): Promise<void> {
  const recs = await findRecommendations()
  if (!recs.length) return
  if (app().settings.compress.autoMode === 'auto') {
    const { count, saved } = await runQueue(recs.map((p) => p.rec))
    if (count) app().set({ toast: { key: 'compress.autoDone', count, bytes: saved } })
  } else if (!app().compressOffer) {
    app().set({ compressOffer: recs })
  }
}

/** "Later": not proposed again until the app is reopened. */
export function postpone(ids: string[]) {
  for (const id of ids) later.add(id)
  app().set({ compressOffer: null })
}

/** Files the user unticked in the proposal: never proposed again (the Compress button still works). */
export async function decline(ids: string[]) {
  for (const id of ids) await setCompression(id, { status: 'declined' })
  if (ids.length) await markMetaDirty()
}

/** Compresses the chosen media (after the user saw the list and the estimate). */
export async function compressNow(planned: Planned[]): Promise<{ count: number; saved: number }> {
  await recordSkips(planned)
  return runQueue(planned.filter((p) => p.plan.ok).map((p) => p.rec))
}

export function cancelCompression() {
  abort?.abort()
}
