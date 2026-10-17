import { beforeEach, describe, expect, it, vi } from 'vitest'

const kv = new Map<string, unknown>()
const moved: [string, string, string][] = []
let failNext = false

vi.mock('../src/db/db', () => ({
  db: () => ({
    getKv: async (k: string) => kv.get(k),
    setKv: async (k: string, v: unknown) => void kv.set(k, structuredClone(v)),
  }),
}))
vi.mock('../src/store', () => ({ app: () => ({ set: () => undefined }) }))
vi.mock('../src/drive/api', () => ({
  DriveError: class extends Error {
    status = 500
  },
  moveFile: async (id: string, to: string, from: string) => {
    if (failNext) {
      failNext = false
      throw new Error('offline')
    }
    moved.push([id, to, from])
  },
}))

const { flushMoves, keepPendingPlaces, pendingMoves, queueMove } = await import('../src/sync/moveQueue')

describe('moves sent to Drive in the background', () => {
  beforeEach(() => {
    kv.clear()
    moved.length = 0
    vi.stubGlobal('navigator', { onLine: false })
  })

  it('keeps where the photo is on Drive when it is moved again before Drive did it', async () => {
    await queueMove('p1', 'A', 'inbox')
    await queueMove('p1', 'B', 'A')
    expect(await pendingMoves()).toEqual({ p1: { to: 'B', from: 'inbox' } })
    // Back where it was on Drive: nothing to do.
    await queueMove('p1', 'inbox', 'B')
    expect(await pendingMoves()).toEqual({})
  })

  it('a load from Drive meanwhile keeps the new place', async () => {
    await queueMove('p1', 'A', 'inbox')
    const media = [{ id: 'p1', folderId: 'inbox' }, { id: 'p2', folderId: 'inbox' }] as never[]
    await keepPendingPlaces(media)
    expect(media.map((m: { folderId: string }) => m.folderId)).toEqual(['A', 'inbox'])
  })

  it('sends every move, and keeps the ones that failed for later', async () => {
    await queueMove('p1', 'A', 'inbox')
    await queueMove('p2', 'B', 'inbox')
    failNext = true
    await expect(flushMoves()).rejects.toThrow()
    expect(Object.keys(await pendingMoves())).toHaveLength(1)
    await flushMoves()
    expect(await pendingMoves()).toEqual({})
    expect(moved.map((m) => m[0]).sort()).toEqual(['p1', 'p2'])
    expect(moved.find((m) => m[0] === 'p1')).toEqual(['p1', 'A', 'inbox'])
  })
})
