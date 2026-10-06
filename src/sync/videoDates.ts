// Videos copied into Drive show the date of the copy. Their real recording
// date is inside the file: read it (a few hundred bytes from Drive), use it,
// and remember it on the file (hidden property) for every device.

import { db } from '../db/db'
import { downloadRange, setAppProperties } from '../drive/api'
import { localIso } from '../lib/media'
import { mp4CreationTime } from '../lib/mp4'
import { markMetaDirty } from './metaStore'

export async function fixVideoDates(): Promise<void> {
  const d = db()
  const checked = new Set((await d.getKv<string[]>('videoDatesChecked')) ?? [])
  const videos = (await d.media.where('type').equals('video').toArray()).filter(
    (v) => !v.appProperties?.mymedia_taken && !checked.has(v.id),
  )
  let changed = false
  for (const v of videos) {
    if (!navigator.onLine) break
    try {
      const date = await mp4CreationTime((a, b) => downloadRange(v.id, a, b), v.size)
      if (date) {
        const taken = localIso(date)
        await setAppProperties(v.id, { mymedia_taken: taken })
        await d.media.update(v.id, { takenAt: taken, appProperties: { ...v.appProperties, mymedia_taken: taken } })
        const meta = await d.meta.get(v.id)
        if (meta && meta.takenAt !== taken) {
          await d.meta.put({ ...meta, takenAt: taken, updatedAt: Date.now() })
          changed = true
        }
      }
    } catch (e) {
      console.warn('[MyMedia] video date not read', v.name, e)
    }
    checked.add(v.id)
    await d.setKv('videoDatesChecked', [...checked])
  }
  if (changed) await markMetaDirty()
}
