// Measures the internet speed by downloading a file of random bytes from MyMedia's
// server (not cached by the browser or the service worker), and remembers the result.

import { toMbps } from '../lib/speed'

const FILE = `${import.meta.env.BASE_URL}speedtest.bin`
const KEY = 'mymedia.speed'
/** A test older than this no longer tells the current speed (the device may have moved). */
const FRESH_MS = 30 * 60_000
const TEST_MS = 6000
/** Downloads at the same time, as speed test sites do: one alone rarely fills a fast line. */
const STREAMS = 3

export interface SpeedResult {
  /** Download, megabits per second. */
  down: number
  at: number
}

interface NetworkInformation extends EventTarget {
  downlink?: number
}
/** Chrome and Android only: the browser's own estimate (at most 10 Mbit/s). */
const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection

let last: SpeedResult | null = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as SpeedResult | null
  } catch {
    return null
  }
})()
const listeners = new Set<() => void>()

export function lastSpeed(): SpeedResult | null {
  return last
}

export function browserEstimate(): number | null {
  return connection?.downlink ? connection.downlink : null
}

/** The speed to show now: a recent test, else the browser's estimate. */
export function currentMbps(): number | null {
  if (last && Date.now() - last.at < FRESH_MS) return last.down
  return browserEstimate()
}

export function subscribeSpeed(cb: () => void): () => void {
  listeners.add(cb)
  connection?.addEventListener('change', cb)
  return () => {
    listeners.delete(cb)
    connection?.removeEventListener('change', cb)
  }
}

const fresh = () => `${FILE}?t=${Date.now()}${Math.random().toString(36).slice(2)}`

export async function testSpeed(onProgress: (ratio: number) => void, signal: AbortSignal): Promise<SpeedResult> {
  let bytes = 0
  const start = performance.now()
  const elapsed = () => performance.now() - start
  const stream = async () => {
    while (elapsed() < TEST_MS) {
      const res = await fetch(fresh(), { cache: 'no-store', signal })
      if (!res.ok || !res.body) throw new Error(`speed test: ${res.status}`)
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        onProgress(Math.min(1, elapsed() / TEST_MS))
        // Time is up: stop in the middle of a file rather than wait for its end.
        if (elapsed() >= TEST_MS) {
          await reader.cancel()
          break
        }
      }
    }
  }
  await Promise.all(Array.from({ length: STREAMS }, stream))
  last = { down: toMbps(bytes, elapsed()), at: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(last))
  } catch {
    // Not remembered: shown until the app is closed.
  }
  onProgress(1)
  for (const cb of listeners) cb()
  return last
}
