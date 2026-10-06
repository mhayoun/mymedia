// People (face groups) for the screens.

import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, hasDb, type FaceRecord, type PersonRecord } from '../db/db'
import { useApp } from '../store'

export interface PersonInfo {
  id: string
  name?: string
  faces: FaceRecord[]
  mediaIds: Set<string>
  /** Best face, for the avatar. */
  cover: FaceRecord
}

export interface People {
  ready: boolean
  /** Named people, by name. */
  named: PersonInfo[]
  /** Unnamed groups with at least 2 faces, biggest first. */
  unnamed: PersonInfo[]
  /** Unnamed groups with a single face. */
  single: PersonInfo[]
  byId: Map<string, PersonInfo>
  /** Faces that are probably a named person (to confirm). */
  toConfirm: FaceRecord[]
  /** Faces of each media. */
  facesOfMedia: Map<string, FaceRecord[]>
}

const EMPTY: People = { ready: false, named: [], unnamed: [], single: [], byId: new Map(), toConfirm: [], facesOfMedia: new Map() }

export function usePeople(): People {
  const user = useApp((s) => s.user)
  const enabled = useApp((s) => s.settings.facesEnabled)
  const data = useLiveQuery(
    async () => {
      if (!hasDb()) return null
      const [faces, persons] = await Promise.all([db().faces.toArray(), db().persons.toArray()])
      return { faces, persons }
    },
    [user?.email],
  )
  return useMemo(() => {
    if (!data || !enabled) return EMPTY
    const persons = new Map<string, PersonRecord>(data.persons.map((p) => [p.id, p]))
    const resolve = (id: string | null) => {
      let p = id ? persons.get(id) : undefined
      for (let guard = 0; p?.mergedInto && guard < 20; guard++) p = persons.get(p.mergedInto)
      return p
    }
    const byId = new Map<string, PersonInfo>()
    const facesOfMedia = new Map<string, FaceRecord[]>()
    for (const f of data.faces) {
      const list = facesOfMedia.get(f.mediaId)
      if (list) list.push(f)
      else facesOfMedia.set(f.mediaId, [f])
      const p = resolve(f.personId)
      if (!p) continue
      let info = byId.get(p.id)
      if (!info) {
        info = { id: p.id, name: p.name, faces: [], mediaIds: new Set(), cover: f }
        byId.set(p.id, info)
      }
      info.faces.push(f)
      info.mediaIds.add(f.mediaId)
      if (f.score * f.box[2] > info.cover.score * info.cover.box[2]) info.cover = f
    }
    const all = [...byId.values()]
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' })
    const toConfirm = data.faces.filter((f) => f.suggested && resolve(f.suggested)?.name && resolve(f.personId)?.id !== resolve(f.suggested)?.id && !resolve(f.personId)?.name)
    return {
      ready: true,
      named: all.filter((p) => p.name).sort((a, b) => collator.compare(a.name!, b.name!)),
      unnamed: all.filter((p) => !p.name && p.faces.length > 1).sort((a, b) => b.faces.length - a.faces.length),
      single: all.filter((p) => !p.name && p.faces.length === 1),
      byId,
      toConfirm,
      facesOfMedia,
    }
  }, [data, enabled])
}
