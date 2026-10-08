// One-time import of the data made with Katia: its myphotos.json gives each
// photo its species, date, text and Facebook group. Photos go into one album
// per species (inside the category that was Katia's folder); photos without
// a species stay in the category itself, where MyMedia suggests one.

import { moveMedia } from '../classify/engine'
import { db } from '../db/db'
import { createFolder, downloadText, findFilesByName, getFile, isFolderEmpty, setAppProperties, trashFile } from '../drive/api'
import { KATIA_INDEX_NAME, parseKatiaIndex, planKatiaImport, type KatiaPlan } from '../lib/katia'
import { nameKey } from '../lib/filename'
import { folderChain, subtreeIds } from '../lib/tree'
import { app } from '../store'
import { syncNow } from '../sync/engine'
import { markMetaDirty } from '../sync/metaStore'

export interface KatiaSource {
  /** Folder holding myphotos.json. */
  folderId: string
  folderName: string
  /** The folder is inside MyMedia (else it must be moved there first). */
  inside: boolean
  plan?: KatiaPlan
  entries: number
  /** Something is left to do (always true before the first import). */
  pending: boolean
}

/** Finds Katia's myphotos.json files and plans what importing them would do. */
export async function findKatiaData(): Promise<KatiaSource[]> {
  await syncNow()
  const rootId = app().rootId!
  const d = db()
  const folders = await d.folders.toArray()
  const folderMap = new Map(folders.map((f) => [f.id, f]))
  const out: KatiaSource[] = []
  for (const f of await findFilesByName(KATIA_INDEX_NAME)) {
    const folderId = f.parents?.[0]
    if (!folderId) continue
    const inside = folderId !== rootId && folderChain(folderId, folderMap, rootId) !== null
    const folderName = folderMap.get(folderId)?.name ?? (await getFile(folderId, 'id,name').catch(() => null))?.name ?? '?'
    const entries = parseKatiaIndex(await downloadText(f.id))
    const source: KatiaSource = { folderId, folderName, inside, entries: entries.length, pending: false }
    if (inside) {
      const ids = subtreeIds(folderId, folders)
      const media = await d.media.where('folderId').anyOf([...ids]).toArray()
      const metas = new Map((await d.meta.bulkGet(media.map((m) => m.id))).filter((m) => !!m).map((m) => [m.id, m]))
      source.plan = planKatiaImport(
        entries,
        folderId,
        folders.filter((x) => ids.has(x.id)),
        media.map((m) => ({
          id: m.id,
          name: m.name,
          folderId: m.folderId,
          takenAt: m.takenAt,
          createdTime: m.createdTime,
          hasOwnDate: m.takenAt !== m.createdTime,
          description: metas.get(m.id)?.description,
          manual: metas.get(m.id)?.source === 'manual',
        })),
      )
    }
    const p = source.plan
    source.pending = !!p && p.actions.length > 0 && (!(await d.getKv<boolean>(`katiaDone:${folderId}`)) || p.species.size + p.toReview + p.dates + p.descriptions > 0)
    out.push(source)
  }
  return out
}

/** Applies the plan. Returns the number of media updated. */
export async function runKatiaImport(
  source: KatiaSource,
  opts: { trashEmptied: boolean },
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const plan = source.plan!
  const d = db()
  const albums = new Map<string, string>() // nameKey(species) → folder id
  for (const f of await d.folders.where('parentId').equals(source.folderId).toArray()) albums.set(nameKey(f.name), f.id)
  const albumFor = async (species: string) => {
    const key = nameKey(species)
    if (!albums.has(key)) {
      const f = await createFolder(species, source.folderId)
      await d.folders.put({ id: f.id, name: species, parentId: source.folderId })
      albums.set(key, f.id)
    }
    return albums.get(key)!
  }

  let done = 0
  try {
    for (const a of plan.actions) {
      const rec = await d.media.get(a.id)
      if (!rec) continue
      if (a.takenAt) {
        await setAppProperties(rec.id, { mymedia_taken: a.takenAt })
        await d.media.update(rec.id, { takenAt: a.takenAt, appProperties: { ...rec.appProperties, mymedia_taken: a.takenAt } })
      }
      const patch = {
        ...(a.species ? { species: { he: a.species } } : {}),
        ...(a.group ? { group: a.group } : {}),
        ...(a.description ? { description: a.description } : {}),
        ...(a.takenAt ? { takenAt: a.takenAt } : {}),
      }
      if (a.moveTo !== undefined) {
        const to = a.moveTo ? await albumFor(a.moveTo) : source.folderId
        await moveMedia(rec, to, { ...patch, source: a.moveTo ? 'manual' : 'folder', confidence: null, auto: false })
      } else {
        const cur = await d.meta.get(rec.id)
        if (cur) await d.meta.put({ ...cur, ...patch, updatedAt: Date.now() })
      }
      onProgress(++done, plan.actions.length)
    }
    await d.setKv(`katiaDone:${source.folderId}`, true)
    if (opts.trashEmptied) {
      for (const id of plan.emptied) if (await isFolderEmpty(id)) await trashFile(id)
    }
  } finally {
    await markMetaDirty()
    await syncNow()
  }
  return done
}
