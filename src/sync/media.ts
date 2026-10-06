// Actions on single media files.

import { db } from '../db/db'
import { trashFile } from '../drive/api'
import { markMetaDirty } from './metaStore'

/** Moves the file to Drive's trash (recoverable for 30 days) and removes it from the app. */
export async function trashMedia(id: string): Promise<void> {
  await trashFile(id)
  const d = db()
  const meta = await d.meta.get(id)
  await d.transaction('rw', [d.media, d.thumbs, d.meta], async () => {
    await d.media.delete(id)
    await d.thumbs.delete(id)
    if (meta) await d.meta.put({ ...meta, deleted: true, updatedAt: Date.now() })
  })
  await markMetaDirty()
}

/** Adds a person's name by hand to media (when the face is not visible or not found). */
export async function addPersonByHand(ids: string[], name: string): Promise<void> {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean) return
  const d = db()
  for (const id of ids) {
    const meta = await d.meta.get(id)
    if (!meta || meta.peopleManual?.includes(clean)) continue
    await d.meta.put({ ...meta, peopleManual: [...(meta.peopleManual ?? []), clean], updatedAt: Date.now() })
  }
  const { updatePeople } = await import('../faces/engine')
  await updatePeople(ids)
  await markMetaDirty()
}

/** Same description for several media. */
export async function setDescription(ids: string[], description: string): Promise<void> {
  const d = db()
  for (const id of ids) {
    const meta = await d.meta.get(id)
    if (meta) await d.meta.put({ ...meta, description: description.trim() || undefined, updatedAt: Date.now() })
  }
  await markMetaDirty()
}
