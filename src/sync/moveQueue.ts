// Photos moved to another album are moved on this device at once; Drive is
// told in the background, a few at a time. The list is kept on the device
// until Drive has done it (offline, errors: tried again later), and a load
// from Drive in the meantime keeps the new place.

import { db, type MediaRecord } from '../db/db'
import { DriveError, moveFile } from '../drive/api'
import { app } from '../store'

const KEY = 'pendingMoves'
const AT_ONCE = 4
const RETRY_MS = 30_000

/** Media id → the folder it goes to, and the folder it is in on Drive. */
type Moves = Record<string, { to: string; from: string }>

let chain: Promise<unknown> = Promise.resolve()
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => undefined)
  return run
}

const read = async () => (await db().getKv<Moves>(KEY)) ?? {}
async function write(moves: Moves) {
  await db().setKv(KEY, moves)
  app().set({ moving: Object.keys(moves).length })
}

/** Moves waiting for Drive. */
export function pendingMoves(): Promise<Moves> {
  return serial(read)
}

/** Asks Drive to move a media (`from`: where it is now on this device). */
export async function queueMove(id: string, to: string, from: string): Promise<void> {
  await serial(async () => {
    const moves = await read()
    // Moved again before Drive did it: Drive still has it in the first folder.
    const drive = moves[id]?.from ?? from
    if (drive === to) delete moves[id]
    else moves[id] = { to, from: drive }
    await write(moves)
  })
  kick()
}

/** The places waiting for Drive win over what Drive says (for a load meanwhile). */
export async function keepPendingPlaces(media: MediaRecord[]): Promise<void> {
  const moves = await pendingMoves()
  for (const m of media) if (moves[m.id]) m.folderId = moves[m.id].to
}

let running: Promise<void> | null = null
let retry: ReturnType<typeof setTimeout> | null = null

async function work(): Promise<void> {
  const todo = Object.entries(await pendingMoves())
  let failed = false
  let next = 0
  const worker = async () => {
    while (next < todo.length && !failed) {
      const [id, m] = todo[next++]
      try {
        await moveFile(id, m.to, m.from)
      } catch (e) {
        // Gone from Drive (deleted meanwhile): nothing left to move.
        if (!(e instanceof DriveError && e.status === 404)) {
          console.warn('[MyMedia] move not done yet', e)
          failed = true
          continue
        }
      }
      await serial(async () => {
        const moves = await read()
        const cur = moves[id]
        if (cur?.to === m.to) delete moves[id]
        // Moved again meanwhile: Drive now has it where it was asked first.
        else if (cur) cur.from = m.to
        await write(moves)
      })
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker))
  if (failed) throw new Error('moves failed')
}

/** Sends the waiting moves to Drive; resolves when none is left (or Drive fails). */
export function flushMoves(): Promise<void> {
  running ??= (async () => {
    try {
      while (Object.keys(await pendingMoves()).length) await work()
    } finally {
      running = null
    }
  })()
  return running
}

/** Starts sending in the background; tried again later on failure. */
export function kick(): void {
  if (retry) {
    clearTimeout(retry)
    retry = null
  }
  void pendingMoves().then((m) => app().set({ moving: Object.keys(m).length }))
  if (!navigator.onLine) return
  flushMoves().catch(() => {
    retry = setTimeout(kick, RETRY_MS)
  })
}

if (typeof window !== 'undefined') window.addEventListener('online', kick)
