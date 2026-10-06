/// <reference lib="webworker" />
// Service worker: caches the app itself so it opens offline, and receives
// files shared to MyMedia from the phone's Share menu (Android).
// Thumbnails are cached by the app in IndexedDB, media is never cached here.

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

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith(new URL('stream/', self.registration.scope).pathname),
  async ({ url, request }) => {
    const id = url.pathname.split('/').pop()!
    const size = Number(url.searchParams.get('size'))
    const type = url.searchParams.get('type') ?? 'video/mp4'
    if (!driveToken || !size) return new Response(null, { status: 401 })
    const m = /bytes=(\d+)-(\d*)/.exec(request.headers.get('Range') ?? '')
    const start = m ? Number(m[1]) : 0
    const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${driveToken}`, Range: `bytes=${start}-${end}` },
    })
    if (!res.ok) return new Response(null, { status: res.status })
    const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) })
    if (m) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    return new Response(res.body, { status: m ? 206 : 200, headers })
  },
)

registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
