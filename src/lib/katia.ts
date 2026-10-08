// Data made with Katia (the earlier bird app): its myphotos.json and the
// Facebook export. Pure helpers, tested.

import { localIso } from './media'
import { nameKey } from './filename'

export const KATIA_INDEX_NAME = 'myphotos.json'

/** One entry of Katia's myphotos.json (album = the Drive folder of the photo). */
export interface KatiaEntry {
  file: string
  album: string
  group: string | null
  date: string | null
  description: string | null
  species: string
  context: string
}

/** Katia put the photos of the Facebook ZIP in albums "MyPhotos — <group>"; other albums are folders imported by hand. */
export const isFacebookAlbum = (album: string) => /^MyPhotos\s*[—–-]\s*/.test(album)

/**
 * Where a Katia photo came from. For folders imported by hand, Katia wrote the
 * folder name as its "group" (and reduced the photos: 1600 px, JPEG 72 %).
 */
export function katiaProvenance(e: Pick<KatiaEntry, 'album' | 'group'>): { group?: string; folder?: string } {
  if (isFacebookAlbum(e.album)) return e.group ? { group: e.group } : {}
  return e.album ? { folder: e.album } : {}
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export function parseKatiaIndex(text: string): KatiaEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: KatiaEntry[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const file = str(r?.file)
    if (!file) continue
    out.push({
      file,
      album: str(r.album),
      group: str(r.group) || null,
      date: str(r.date) || null,
      description: str(r.description) || null,
      species: cleanSpecies(str(r.species)),
      context: str(r.context),
    })
  }
  return out
}

/** A species name, or "" for caption-like text (quotes, "…", more than 3 words). */
export function cleanSpecies(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t || /["'“”…?!/\\]/.test(t) || t.split(' ').length > 3) return ''
  return t
}

/**
 * Katia's dates: ISO ("2026-01-26T04:17:00.000Z", from EXIF) or the Facebook
 * text ("Jan 26, 2026 6:17:00 am"). Returns local "YYYY-MM-DDTHH:mm:ss".
 */
export function katiaDate(s: string | null): string | null {
  if (!s) return null
  const d = new Date(s.replace(/\bpm\b/i, 'PM').replace(/\bam\b/i, 'AM'))
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return null
  return localIso(d)
}

/** Description of a media: Katia's text, plus the place/season note when it adds something. */
export function katiaDescription(e: Pick<KatiaEntry, 'description' | 'context'>): string {
  const desc = e.description ?? ''
  if (!e.context || nameKey(desc).includes(nameKey(e.context))) return desc
  return desc ? `${desc} — ${e.context}` : e.context
}

/** Known species found in a text (whole name, longest first), or null. */
export function speciesInText(text: string | null, known: string[]): string | null {
  if (!text) return null
  const t = ` ${nameKey(text)} `
  let best: string | null = null
  let bestLen = 0
  for (const sp of known) {
    const k = nameKey(sp)
    if (k.length < 2) continue
    if (t.includes(` ${k} `) && k.length > bestLen) {
      best = sp
      bestLen = k.length
    }
  }
  return best
}

// ---- Plan of the import of myphotos.json ------------------------------------

export interface PlanMedia {
  id: string
  name: string
  folderId: string
  takenAt: string
  createdTime: string
  hasOwnDate: boolean
  description?: string
  manual?: boolean
}

export interface PlanFolder {
  id: string
  name: string
  parentId: string
}

export interface KatiaAction {
  id: string
  /** Album (species) to move into; '' = the category itself (to be reviewed). Undefined = stays. */
  moveTo?: string
  species?: string
  takenAt?: string
  description?: string
  group?: string
  /** Folder imported by hand into Katia (its photos were reduced by Katia). */
  folder?: string
}

export interface KatiaPlan {
  actions: KatiaAction[]
  /** Media of the folder with no entry in myphotos.json. */
  unmatched: number
  /** Species name → number of photos moved there. */
  species: Map<string, number>
  toReview: number
  dates: number
  descriptions: number
  /** Katia album folders that will be left without photos. */
  emptied: string[]
}

/**
 * What to do with each media below Katia's folder (the folder holding
 * myphotos.json, now a category): photos with a species go to the album of
 * that species, the others to the category itself so MyMedia suggests one.
 * Photos already moved by the user since Katia (not in their Katia album
 * any more) are only completed (date, description), never moved.
 */
export function planKatiaImport(
  entries: KatiaEntry[],
  baseId: string,
  folders: PlanFolder[],
  media: PlanMedia[],
): KatiaPlan {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const byKey = new Map<string, KatiaEntry>()
  const byName = new Map<string, KatiaEntry | null>()
  for (const e of entries) {
    byKey.set(`${e.album}/${e.file}`, e)
    byName.set(e.file, byName.has(e.file) ? null : e) // null = ambiguous
  }
  const knownSpecies = new Set(entries.map((e) => nameKey(e.species)).filter(Boolean))

  const plan: KatiaPlan = { actions: [], unmatched: 0, species: new Map(), toReview: 0, dates: 0, descriptions: 0, emptied: [] }
  const left = new Map<string, number>() // Katia album id → photos staying in it
  for (const m of media) {
    const folder = folderById.get(m.folderId)
    const inKatiaAlbum = folder?.parentId === baseId
    if (inKatiaAlbum) left.set(folder.id, (left.get(folder.id) ?? 0) + 1)
    const entry = (inKatiaAlbum ? byKey.get(`${folder.name}/${m.name}`) : undefined) ?? byName.get(m.name) ?? null
    if (!entry) {
      plan.unmatched++
      continue
    }
    const a: KatiaAction = { id: m.id }
    if (entry.species) a.species = entry.species
    Object.assign(a, katiaProvenance(entry))
    const date = m.hasOwnDate ? null : katiaDate(entry.date)
    if (date && date !== katiaDate(m.takenAt)) {
      a.takenAt = date
      plan.dates++
    }
    const desc = katiaDescription(entry)
    if (desc && !m.description) {
      a.description = desc
      plan.descriptions++
    }
    // Only photos still in the Katia album they were saved in are moved.
    const original = inKatiaAlbum && folder.name === entry.album && !m.manual
    if (original) {
      if (entry.species) {
        if (nameKey(folder.name) !== nameKey(entry.species)) {
          a.moveTo = entry.species
          plan.species.set(entry.species, (plan.species.get(entry.species) ?? 0) + 1)
          left.set(folder.id, left.get(folder.id)! - 1)
        }
      } else if (!knownSpecies.has(nameKey(folder.name))) {
        a.moveTo = ''
        plan.toReview++
        left.set(folder.id, left.get(folder.id)! - 1)
      }
    }
    plan.actions.push(a)
  }
  const target = new Set([...plan.species.keys()].map(nameKey))
  plan.emptied = [...left.entries()]
    .filter(([id, n]) => n === 0 && !target.has(nameKey(folderById.get(id)!.name)))
    .filter(([id]) => !folders.some((f) => f.parentId === id))
    .map(([id]) => id)
  return plan
}
