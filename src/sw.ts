/// <reference lib="webworker" />
// Service worker: caches the app itself so it opens offline, and receives
// files shared to MyMedia from the phone's Share menu (Android).
// Thumbnails are cached by the app in IndexedDB; videos played are kept here
// (a limited amount) so they start at once the next time.

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
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
/** Videos being kept while they play: a jump elsewhere in the video stops it, for the jump to get all the bandwidth. */
const keeping = new Map<string, AbortController>()

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
 * Plays the video from its start and keeps it from the same download (one
 * download, not two: on mobile data a second, parallel one made the video
 * stop and go). Stops when the video stops reading (viewer closed).
 */
function playAndKeep(body: ReadableStream<Uint8Array>, abort: AbortController, keep: (blob: Blob) => Promise<void>): { stream: ReadableStream<Uint8Array>; done: Promise<void> } {
  const [toVideo, toCache] = body.tee()
  const done = (async () => {
    const chunks: Uint8Array[] = []
    const reader = toCache.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      await keep(new Blob(chunks as BlobPart[]))
    } catch {
      // stopped: it will stream again next time
    }
  })()
  const reader = toVideo.getReader()
  const stream = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { done, value } = await reader.read()
        if (done) c.close()
        else c.enqueue(value)
      } catch (e) {
        c.error(e)
      }
    },
    cancel() {
      abort.abort()
    },
  })
  return { stream, done }
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
      const part = (await kept.blob()).slice(start, end + 1)
      const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(part.size) })
      if (m) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
      return new Response(part, { status: m ? 206 : 200, headers })
    }

    if (!driveToken || !size) return new Response(null, { status: 401 })
    // From the start to the end: the whole file, kept while it plays. Elsewhere (a jump): that part only.
    const whole = start === 0 && end === size - 1 && !!version && size <= VIDEO_MAX_FILE && !keeping.has(id)
    if (!whole) keeping.get(id)?.abort()
    const abort = new AbortController()
    if (whole) keeping.set(id, abort)
    let res: Response
    try {
      res = await fetch(driveMedia(id), {
        headers: { Authorization: `Bearer ${driveToken}`, Range: `bytes=${start}-${end}` },
        signal: abort.signal,
      })
    } catch {
      if (keeping.get(id) === abort) keeping.delete(id)
      return new Response(null, { status: 504 })
    }
    if (!res.ok || !res.body) {
      if (keeping.get(id) === abort) keeping.delete(id)
      return new Response(null, { status: res.status })
    }
    const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) })
    if (m) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    if (whole) {
      const { stream, done } = playAndKeep(res.body, abort, (blob) => storeVideo(id, version, size, type, blob))
      ;(event as ExtendableEvent).waitUntil(done.finally(() => keeping.get(id) === abort && keeping.delete(id)))
      return new Response(stream, { status: m ? 206 : 200, headers })
    }
    return new Response(res.body, { status: m ? 206 : 200, headers })
  },
)

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
