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
