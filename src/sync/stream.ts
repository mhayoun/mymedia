// Gives the service worker the current Google access token so it can stream
// videos from Drive (see sw.ts). Without a service worker (first visit,
// development), videos are downloaded entirely before playing.

import { auth } from '../auth/google'

function controller(): ServiceWorker | null {
  return 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null
}

async function send(token: string): Promise<boolean> {
  const sw = controller()
  if (!sw) return false
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 1500)
    channel.port1.onmessage = () => {
      clearTimeout(timer)
      resolve(true)
    }
    sw.postMessage({ type: 'driveToken', token }, [channel.port2])
  })
}

/** Address to play a Drive video while it downloads, or null if streaming is not available. */
export async function streamUrl(rec: { id: string; size: number; mimeType: string; md5?: string; modifiedTime: string }): Promise<string | null> {
  if (!controller() || !rec.size) return null
  if (!(await send(await auth.getToken()))) return null
  // v: the version of the file, so the copy kept on the device is replaced when it changes.
  const params = new URLSearchParams({ size: String(rec.size), type: rec.mimeType || 'video/mp4', v: rec.md5 ?? rec.modifiedTime })
  return `${import.meta.env.BASE_URL}stream/${encodeURIComponent(rec.id)}?${params}`
}

/** Keeps the service worker's token fresh (it expires every hour). */
export function keepStreamTokenFresh() {
  auth.subscribe(() => {
    if (auth.status === 'signedIn') void auth.getToken().then(send)
  })
}
