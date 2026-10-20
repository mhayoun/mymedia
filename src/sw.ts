/// <reference lib="webworker" />
// Service worker: caches the app itself so it opens offline, and receives
// files shared to MyMedia from the phone's Share menu (Android).
// Thumbnails are cached by the app in IndexedDB; videos played are kept here
// (a limited amount) so they start at once the next time.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { VIDEO_CHANNEL, type VideoProgress } from './lib/videoBuffer'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clientsClaim } from 'workbox-core'

declare const self: ServiceWorkerGlobalScope

const SHARED_CACHE = 'mymedia-shared'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Shared files are kept until the app has uploaded them (or the user cancelled).
registerRoute(
  ({ url, request }) => request.method === 'POST' && url.pathname.endsWith('/share-target'),
  async ({ request }) => {
    const form = await request.formData()
    const files = form.getAll('media').filter((f): f is File => f instanceof File)
    const cache = await caches.open(SHARED_CACHE)
    for (const key of await cache.keys()) await cache.delete(key)
    for (const [i, file] of files.entries()) {
      await cache.put(
        new Request(`${self.registration.scope}shared/${i}`),
        new Response(file, {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-name': encodeURIComponent(file.name),
            'x-modified': String(file.lastModified || Date.now()),
          },
        }),
      )
    }
    return Response.redirect(`${self.registration.scope}?shared=${files.length}`, 303)
  },
  'POST',
)

// Video streaming: the video player cannot send the Google authorisation, so
// it asks this worker (…/stream/<fileId>), which forwards each piece (HTTP
// Range) to Drive with the user's access token. Playback starts at once and
// seeking works, without downloading the whole file first.
let driveToken: string | null = null

self.addEventListener('message', (event) => {
  if (event.data?.type === 'driveToken') {
    driveToken = event.data.token
    event.ports[0]?.postMessage('ok')
  }
})

const VIDEO_CACHE = 'mymedia-videos'
/** Videos kept on the device: each up to 200 MB, 1 GB in all (oldest removed first). */
const VIDEO_MAX_FILE = 200 * 1024 * 1024
const VIDEO_MAX_TOTAL = 1024 * 1024 * 1024
/** A part this far past what has arrived does not wait for it: it is asked for directly. */
const NEAR = 4 * 1024 * 1024
/** How much of a playing video has arrived, for the viewer to start when the rest will come in time. */
const progress = new BroadcastChannel(VIDEO_CHANNEL)

const driveMedia = (id: string) => `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`
const videoKey = (id: string, version: string) => new Request(`${self.registration.scope}__video/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}`)

async function storeVideo(id: string, version: string, size: number, type: string, blob: Blob) {
  if (blob.size !== size) return
  const cache = await caches.open(VIDEO_CACHE)
  for (const k of await cache.keys()) if (k.url.includes(`/__video/${encodeURIComponent(id)}?`)) await cache.delete(k)
  await cache.put(videoKey(id, version), new Response(blob, { headers: { 'Content-Type': type, 'X-Size': String(size) } }))
  // Oldest first: remove until under the limit.
  const keys = await cache.keys()
  const sizes = await Promise.all(keys.map(async (k) => Number((await cache.match(k))?.headers.get('X-Size') ?? 0)))
  let total = sizes.reduce((a, b) => a + b, 0)
  for (let i = 0; i < keys.length - 1 && total > VIDEO_MAX_TOTAL; i++) {
    await cache.delete(keys[i])
    total -= sizes[i]
  }
}

/**
 * A video playing: downloaded once, from start to end, as fast as the
 * network allows, whatever the player reads; the player reads from it.
 * On mobile data a second, parallel download (to keep the video) made it
 * stop and go. Kept on the device once complete.
 */
interface Download {
  chunks: Uint8Array[]
  /** Offset of each chunk in the file. */
  offsets: number[]
  loaded: number
  size: number
  state: 'loading' | 'done' | 'failed'
  abort: AbortController
  wake: Set<() => void>
  done?: Promise<void>
}
const downloads = new Map<string, Download>()

function startDownload(id: string, version: string, size: number, type: string): Download {
  const dl: Download = { chunks: [], offsets: [], loaded: 0, size, state: 'loading', abort: new AbortController(), wake: new Set() }
  downloads.set(id, dl)
  const notify = () => {
    for (const w of dl.wake) w()
    dl.wake.clear()
  }
  dl.done = (async () => {
    let told = 0
    try {
      const res = await fetch(driveMedia(id), { headers: { Authorization: `Bearer ${driveToken}` }, signal: dl.abort.signal })
      if (!res.ok || !res.body) throw new Error(String(res.status))
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        dl.offsets.push(dl.loaded)
        dl.chunks.push(value)
        dl.loaded += value.byteLength
        notify()
        if (Date.now() - told > 250) {
          told = Date.now()
          progress.postMessage({ id, loaded: dl.loaded, size } satisfies VideoProgress)
        }
      }
      dl.state = 'done'
      progress.postMessage({ id, loaded: dl.loaded, size } satisfies VideoProgress)
      notify()
      await storeVideo(id, version, size, type, new Blob(dl.chunks as BlobPart[]))
    } catch {
      dl.state = 'failed'
      notify()
    } finally {
      if (downloads.get(id) === dl) downloads.delete(id)
    }
  })()
  return dl
}

/** Bytes start..end of a download, as they arrive. */
function readFrom(dl: Download, start: number, end: number): ReadableStream<Uint8Array> {
  let pos = start
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      while (pos > end || dl.loaded <= pos) {
        if (pos > end) return c.close()
        if (dl.state === 'failed') return c.error(new Error('video download failed'))
        if (dl.state === 'done') return c.close()
        await new Promise<void>((r) => dl.wake.add(r))
      }
      // The chunk holding pos (chunks are in order).
      let lo = 0
      let hi = dl.offsets.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (dl.offsets[mid] <= pos) lo = mid
        else hi = mid - 1
      }
      const chunk = dl.chunks[lo]
      const from = pos - dl.offsets[lo]
      const part = chunk.subarray(from, Math.min(chunk.byteLength, from + end - pos + 1))
      pos += part.byteLength
      c.enqueue(part)
    },
  })
}

// The viewer closed this video: stop downloading it.
progress.onmessage = (e: MessageEvent<{ stop?: string }>) => {
  const id = e.data?.stop
  const dl = id ? downloads.get(id) : undefined
  if (dl && dl.state === 'loading') dl.abort.abort()
}

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(new URL('stream/', self.registration.scope).pathname),
  async ({ url, request, event }) => {
    const id = decodeURIComponent(url.pathname.split('/').pop()!)
    const size = Number(url.searchParams.get('size'))
    const type = url.searchParams.get('type') ?? 'video/mp4'
    const version = url.searchParams.get('v') ?? ''
    const m = /bytes=(\d+)-(\d*)/.exec(request.headers.get('Range') ?? '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (size && start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })

    // Already on the device: no network at all.
    const kept = version ? await (await caches.open(VIDEO_CACHE)).match(videoKey(id, version)) : undefined
    if (kept && size) {
      progress.postMessage({ id, loaded: size, size } satisfies VideoProgress)
      const part = (await kept.blob()).slice(start, end + 1)
      const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(part.size) })
      if (m) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
      return new Response(part, { status: m ? 206 : 200, headers })
    }

    if (!driveToken || !size) return new Response(null, { status: 401 })
    const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) })
    if (m) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    // A part far past what has arrived (a jump, the end of the file read first): asked for directly.
    let dl = downloads.get(id)
    if (dl && dl.state !== 'done' && start > dl.loaded + NEAR) dl = undefined
    else if (!dl && version && size <= VIDEO_MAX_FILE && start <= NEAR) {
      dl = startDownload(id, version, size, type)
      ;(event as ExtendableEvent).waitUntil(dl.done!)
    }
    if (dl && dl.state !== 'failed') return new Response(readFrom(dl, start, end), { status: m ? 206 : 200, headers })
    const res = await fetch(driveMedia(id), {
      headers: { Authorization: `Bearer ${driveToken}`, Range: `bytes=${start}-${end}` },
    })
    if (!res.ok) return new Response(null, { status: res.status })
    return new Response(res.body, { status: m ? 206 : 200, headers })
  },
)

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
