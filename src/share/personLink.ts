// Sharing one person by a link: the photos and videos where the user confirmed this person's face.
// Drive shares only folders or single files, and a person's photos are in many albums: each of them
// is set to "anyone with the link", and a small list (mymedia-person-<id>.json in the root folder, also
// "anyone with the link") says which ones to show. The link opens that list (ui/PublicLibrary).
// The list is kept up to date when faces change (after each save of mymedia-faces.json).

import { db, type PersonRecord } from '../db/db'
import { createTextFile, downloadText, linkPermission, listFiles, removePermission, shareWithLink, trashFile, updateTextFile } from '../drive/api'
import { personShareLink } from '../lib/publicLink'
import { app } from '../store'

const PREFIX = 'mymedia-person-'
const fileName = (personId: string) => `${PREFIX}${personId}.json`
/** Several files shared at a time (Drive slows down above a few per second). */
const AT_ONCE = 4

export interface SharedItem {
  id: string
  name: string
  mimeType: string
  takenAt: string
}

/** The public list of a shared person (read without signing in by the link's page). */
export interface PersonShareFile {
  format: 'mymedia-person'
  version: 1
  personId: string
  name: string
  owner: string
  updatedAt: string
  media: SharedItem[]
}

export interface PersonShare {
  fileId: string
  data: PersonShareFile
}

function resolver(persons: PersonRecord[]) {
  const byId = new Map(persons.map((p) => [p.id, p]))
  return (id: string | null | undefined): PersonRecord | undefined => {
    let p = id ? byId.get(id) : undefined
    for (let guard = 0; p?.mergedInto && guard < 20; guard++) p = byId.get(p.mergedInto)
    return p
  }
}

/**
 * The photos and videos of this person whose face the user confirmed (put in the person by hand, said
 * "yes" to "Is it X?", merged…), newest first; and how many more MyMedia only recognized by itself.
 */
export async function confirmedMedia(personId: string): Promise<{ items: SharedItem[]; recognizedOnly: number }> {
  const d = db()
  const [faces, persons] = await Promise.all([d.faces.toArray(), d.persons.toArray()])
  const resolve = resolver(persons)
  const target = resolve(personId)?.id ?? personId
  const confirmed = new Set<string>()
  const all = new Set<string>()
  for (const f of faces) {
    if (resolve(f.personId)?.id !== target) continue
    all.add(f.mediaId)
    if (f.by === 'manual') confirmed.add(f.mediaId)
  }
  const media = (await d.media.bulkGet([...confirmed])).filter((m) => !!m && (m.type === 'photo' || m.type === 'video'))
  const items = media
    .map((m) => ({ id: m!.id, name: m!.name, mimeType: m!.mimeType, takenAt: m!.takenAt }))
    .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1))
  const rest = (await d.media.bulkGet([...all].filter((id) => !confirmed.has(id)))).filter((m) => !!m && (m.type === 'photo' || m.type === 'video'))
  return { items, recognizedOnly: rest.length }
}

/** Every person shared by a link from this library. */
export async function personShares(): Promise<PersonShare[]> {
  const rootId = app().rootId
  if (!rootId) return []
  const files: { id: string; name: string }[] = []
  await listFiles(
    `name contains '${PREFIX}' and '${rootId}' in parents and trashed = false`,
    (page) => void files.push(...page.filter((f) => f.name.startsWith(PREFIX) && f.name.endsWith('.json'))),
    undefined,
    'id,name',
  )
  const out: PersonShare[] = []
  for (const f of files) {
    try {
      const data = JSON.parse(await downloadText(f.id)) as PersonShareFile
      if (data.format === 'mymedia-person') out.push({ fileId: f.id, data })
    } catch {
      // Unreadable: left alone.
    }
  }
  return out
}

/** The share of this person (or of a person merged into it), or null. */
export async function personShare(personId: string): Promise<PersonShare | null> {
  const resolve = resolver(await db().persons.toArray())
  const target = resolve(personId)?.id ?? personId
  return (await personShares()).find((s) => (resolve(s.data.personId)?.id ?? s.data.personId) === target) ?? null
}

/** Runs `task` on every item, a few at a time, reporting how many are done. */
async function eachAtOnce<T>(list: T[], task: (x: T) => Promise<void>, onProgress?: (done: number, total: number) => void) {
  let next = 0
  let done = 0
  onProgress?.(0, list.length)
  const worker = async () => {
    while (next < list.length) {
      const x = list[next++]
      await task(x)
      onProgress?.(++done, list.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.length) }, worker))
}

/** Stops the link of a file set on it (one shown through a shared album above keeps that one). */
async function unshareFile(id: string): Promise<void> {
  try {
    const perm = await linkPermission(id)
    if (perm && !perm.inherited) await removePermission(id, perm.id)
  } catch (e) {
    // Deleted since, or a permission set on a folder above: nothing more to stop here.
    if (!/inherited|not ?found|404/i.test((e as Error).message)) throw e
  }
}

/** Files to stop: not shown by another person's link any more. */
async function stillSharedElsewhere(exceptFileId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const s of await personShares()) if (s.fileId !== exceptFileId) for (const m of s.data.media) ids.add(m.id)
  return ids
}

let chain: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

/**
 * Shares (or brings up to date) this person by a link: the new confirmed files are shared, those no
 * longer confirmed stop being, and the list is written. Returns the link.
 */
export function sharePerson(personId: string, onProgress?: (done: number, total: number) => void): Promise<string> {
  return serial(async () => {
    const rootId = app().rootId
    if (!rootId) throw new Error('No library')
    const resolve = resolver(await db().persons.toArray())
    const person = resolve(personId)
    const { items } = await confirmedMedia(personId)
    const existing = await personShare(personId)
    const before = new Set(existing?.data.media.map((m) => m.id) ?? [])
    const now = new Set(items.map((m) => m.id))
    const user = app().user
    const data: PersonShareFile = {
      format: 'mymedia-person',
      version: 1,
      personId: person?.id ?? personId,
      name: person?.name ?? existing?.data.name ?? '',
      owner: user?.name || user?.email || '',
      updatedAt: new Date().toISOString(),
      media: items,
    }
    // The files first: once the list is shared, everything it shows can be seen.
    const toAdd = existing ? items.filter((m) => !before.has(m.id)) : items
    await eachAtOnce(toAdd, (m) => shareWithLink(m.id), onProgress)
    const toRemove = [...before].filter((id) => !now.has(id))
    if (toRemove.length) {
      const elsewhere = await stillSharedElsewhere(existing!.fileId)
      await eachAtOnce(toRemove.filter((id) => !elsewhere.has(id)), unshareFile)
    }
    const text = JSON.stringify(data)
    let fileId = existing?.fileId
    if (fileId) {
      if (JSON.stringify({ ...existing!.data, updatedAt: '' }) !== JSON.stringify({ ...data, updatedAt: '' })) await updateTextFile(fileId, text)
    } else {
      fileId = (await createTextFile(fileName(data.personId), rootId, text)).id
      await shareWithLink(fileId)
    }
    return personShareLink(fileId)
  })
}

/** Stops sharing this person: the link no longer works, and each of its files stops being shared. */
export function stopPersonShare(personId: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  return serial(async () => {
    const share = await personShare(personId)
    if (!share) return
    // The list first: the link stops at once.
    const perm = await linkPermission(share.fileId)
    if (perm && !perm.inherited) await removePermission(share.fileId, perm.id)
    const elsewhere = await stillSharedElsewhere(share.fileId)
    await eachAtOnce(
      share.data.media.map((m) => m.id).filter((id) => !elsewhere.has(id)),
      unshareFile,
      onProgress,
    )
    await trashFile(share.fileId)
  })
}

let refreshing: Promise<void> | null = null
let refreshAgain = false

/** After a change of the faces: every shared person follows its confirmed photos. */
export function refreshPersonShares(): Promise<void> {
  if (refreshing) {
    refreshAgain = true
    return refreshing
  }
  refreshing = (async () => {
    do {
      refreshAgain = false
      await refreshOnce()
    } while (refreshAgain)
  })().finally(() => (refreshing = null))
  return refreshing
}

async function refreshOnce(): Promise<void> {
  if (!app().rootId || app().readOnly) return
  const shares = await personShares()
  for (const s of shares) {
    const { items } = await confirmedMedia(s.data.personId)
    const resolve = resolver(await db().persons.toArray())
    const p = resolve(s.data.personId)
    const same =
      items.length === s.data.media.length &&
      items.every((m, i) => m.id === s.data.media[i].id && m.takenAt === s.data.media[i].takenAt) &&
      (p?.name ?? s.data.name) === s.data.name &&
      (p?.id ?? s.data.personId) === s.data.personId
    if (!same) await sharePerson(s.data.personId)
  }
}
