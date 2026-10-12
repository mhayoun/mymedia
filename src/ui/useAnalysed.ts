import { useLiveQuery } from 'dexie-react-hooks'
import { db, type MediaRecord } from '../db/db'
import { mediaVersion } from '../ml/indexStore'

/**
 * Whether a media has been analysed (its fingerprint computed, or found
 * unreadable): until then it cannot get a suggestion. Undefined while loading.
 */
export function useAnalysed(): ((rec: MediaRecord) => boolean) | undefined {
  const versions = useLiveQuery(async () => {
    const out = new Map<string, string>()
    await db().embeddings.each((e) => void out.set(e.id, e.version))
    return out
  })
  return versions && ((rec) => versions.get(rec.id) === mediaVersion(rec))
}
