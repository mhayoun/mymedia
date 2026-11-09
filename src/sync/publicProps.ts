// MyMedia's notes on files (real date, date set by hand, compression, original's MD5, copy
// of…) were written only as private properties, which only the Google Cloud project that
// wrote them can read. Since 1.0.47 every note is also written as a public property, read by
// any project of MyMedia (see drive/api.ts). This copies the older ones once, while the
// project that wrote them can still read them: afterwards the app can sign in through
// another project (free and Pro) without losing them.

import { db } from '../db/db'
import { childrenQuery, DriveError, getFile, listFiles, setPublicProperties, type DriveFile } from '../drive/api'
import { app } from '../store'

const DONE_KEY = 'publicPropsCopied'
const PARENTS_PER_QUERY = 25
const WORKERS = 4
const FIELDS = 'id,appProperties,properties'

/** Tried once per visit: a file that cannot be changed is not tried again and again. */
let tried = false
let running: Promise<void> | null = null

interface Todo {
  id: string
  props: Record<string, string>
}

/** What a file needs: its notes as public properties, when Drive has only the private ones. */
export function publicCopyOf(f: Pick<DriveFile, 'id' | 'appProperties' | 'privateOnly'>): Todo | null {
  return f.privateOnly && f.appProperties && Object.keys(f.appProperties).length ? { id: f.id, props: f.appProperties } : null
}

/** Every file of the library (and the root folder), read again from Drive with both kinds of notes. */
async function scanLibrary(rootId: string): Promise<Todo[]> {
  const todo: Todo[] = []
  const root = publicCopyOf(await getFile(rootId, FIELDS))
  if (root) todo.push(root)
  const folders = (await db().folders.toCollection().primaryKeys()) as string[]
  const parents = [rootId, ...folders]
  for (let i = 0; i < parents.length; i += PARENTS_PER_QUERY) {
    await listFiles(childrenQuery(parents.slice(i, i + PARENTS_PER_QUERY)), (files) => {
      for (const f of files) {
        const t = publicCopyOf(f)
        if (t) todo.push(t)
      }
    }, undefined, FIELDS)
  }
  return todo
}

/**
 * Drive refuses this file for good (not ours to change, gone, notes too long): trying again
 * on the next visit would give the same answer, so it does not hold the first copy back.
 */
function refusedForGood(e: unknown): boolean {
  return e instanceof DriveError && e.status >= 400 && e.status < 500 && e.status !== 429
}

/** Writes the public copies, a few files at a time. Returns how many failed for a passing reason. */
async function writeAll(todo: Todo[]): Promise<number> {
  const d = db()
  let next = 0
  let failed = 0
  let refused = 0
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++]
      try {
        await setPublicProperties(t.id, t.props)
        await d.media.update(t.id, { privateOnly: undefined })
      } catch (e) {
        if (refusedForGood(e)) {
          refused++
          // Not offered again by the next syncs either.
          await d.media.update(t.id, { privateOnly: undefined }).catch(() => undefined)
        } else failed++
        console.warn('[MyMedia] public copy of the notes not written', t.id, e)
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))
  if (todo.length) console.info('[MyMedia] public copy of the notes:', todo.length - failed - refused, 'written,', refused, 'refused by Drive,', failed, 'to try again')
  return failed
}

/**
 * The first time: the whole library is read again and every file with private notes only gets
 * its public copy. Afterwards: only the files a sync found in that state (notes written by an
 * older version of the app, e.g. the Android app not updated yet).
 */
export function copyNotesToPublic(): Promise<void> {
  const rootId = app().rootId
  if (!rootId || app().readOnly || tried || !navigator.onLine) return Promise.resolve()
  running ??= (async () => {
    tried = true
    const d = db()
    const firstTime = !(await d.getKv<boolean>(DONE_KEY))
    const todo = firstTime
      ? await scanLibrary(rootId)
      : (await d.media.filter((r) => !!r.privateOnly).toArray()).map(publicCopyOf).filter((t): t is Todo => t !== null)
    if (todo.length) console.info('[MyMedia] notes copied as public properties:', todo.length)
    const failed = await writeAll(todo)
    if (firstTime && failed === 0) await d.setKv(DONE_KEY, true)
  })()
    .catch((e) => console.warn('[MyMedia] public copy of the notes stopped', e))
    .finally(() => {
      running = null
    })
  return running
}

/**
 * Before this account leaves the Google project that wrote its private notes (a move to MyMedia Pro):
 * waits for their public copy, then says whether every one of them is copied.
 */
export async function notesAllPublic(): Promise<boolean> {
  await (running ?? copyNotesToPublic())
  const d = db()
  if (!(await d.getKv<boolean>(DONE_KEY))) return false
  return (await d.media.filter((r) => !!r.privateOnly).count()) === 0
}
