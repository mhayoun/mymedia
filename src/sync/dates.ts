// The date of photos, changed by the user (MyMedia Pro): kept on the Drive
// file as a hidden property (DATE_SET_KEY), so it holds on every device and
// goes along with transfers; the file itself (EXIF) is not rewritten.

import { db } from '../db/db'
import { FILE_FIELDS, getFile, setAppProperties } from '../drive/api'
import { changedDate, type DateChange } from '../lib/dates'
import { DATE_SET_KEY } from '../lib/media'
import { toRecord } from './engine'
import { markMetaDirty } from './metaStore'

async function keep(id: string, takenAt: string, appProperties: Record<string, string> | undefined) {
  const d = db()
  await d.media.update(id, { takenAt, appProperties })
  const meta = await d.meta.get(id)
  if (meta && meta.takenAt !== takenAt) await d.meta.put({ ...meta, takenAt, updatedAt: Date.now() })
}

/** Gives the photo its new date. Returns false when the change gives no valid date (nothing done). */
export async function changeDate(id: string, change: DateChange): Promise<boolean> {
  const rec = await db().media.get(id)
  const takenAt = rec && changedDate(rec.takenAt, change)
  if (!rec || !takenAt) return false
  await setAppProperties(id, { [DATE_SET_KEY]: takenAt })
  await keep(id, takenAt, { ...rec.appProperties, [DATE_SET_KEY]: takenAt })
  return true
}

/** Back to the photo's own date (camera, else as found when it came into MyMedia). */
export async function resetDate(id: string): Promise<void> {
  const rec = await db().media.get(id)
  if (!rec?.appProperties?.[DATE_SET_KEY]) return
  await setAppProperties(id, { [DATE_SET_KEY]: null })
  const fresh = toRecord(await getFile(id, FILE_FIELDS))
  const { [DATE_SET_KEY]: _, ...rest } = rec.appProperties
  await keep(id, fresh?.takenAt ?? rec.takenAt, fresh?.appProperties ?? rest)
}

/** After changing dates: the metadata file of the library is saved. */
export const datesChanged = () => markMetaDirty()
