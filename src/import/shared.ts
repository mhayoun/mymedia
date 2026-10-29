// Files received from the phone's Share menu (stored by the service worker,
// or in the Android app by the native side).

import { Capacitor } from '@capacitor/core'
import { isNative, native, type NativeSharedFile } from '../native'

const SHARED_CACHE = 'mymedia-shared'

/** Android app: the received files not yet taken. */
let nativeFiles: NativeSharedFile[] = []

/** Android app: reads the files received before the app started (call before the first render). */
export async function loadNativeShared(): Promise<void> {
  if (isNative) nativeFiles = (await native.getShared()).files
}

/** Android app: calls fn each time files are shared while MyMedia is open. */
export function onNativeShare(fn: () => void): () => void {
  if (!isNative) return () => {}
  const handle = native.addListener('shared', () => void loadNativeShared().then(fn))
  return () => void handle.then((h) => h.remove())
}

export function hasSharedFiles(): boolean {
  if (isNative) return nativeFiles.length > 0
  return new URLSearchParams(location.search).has('shared')
}

export async function readSharedFiles(): Promise<File[]> {
  if (isNative) {
    const files: File[] = []
    for (const f of nativeFiles) {
      try {
        const blob = await (await fetch(Capacitor.convertFileSrc(f.path))).blob()
        files.push(new File([blob], f.name, { type: f.type ?? blob.type, lastModified: f.modified || Date.now() }))
      } catch (e) {
        console.warn('[MyMedia] shared file not read', f.name, e)
      }
    }
    return files
  }
  try {
    const cache = await caches.open(SHARED_CACHE)
    const files: File[] = []
    for (const req of await cache.keys()) {
      const res = await cache.match(req)
      if (!res) continue
      const name = decodeURIComponent(res.headers.get('x-name') ?? 'shared')
      files.push(
        new File([await res.blob()], name, {
          type: res.headers.get('content-type') ?? '',
          lastModified: Number(res.headers.get('x-modified')) || Date.now(),
        }),
      )
    }
    return files
  } catch {
    return []
  }
}

export async function clearSharedFiles(): Promise<void> {
  if (isNative) {
    nativeFiles = []
    await native.clearShared()
    return
  }
  try {
    await caches.delete(SHARED_CACHE)
  } catch {
    // nothing to clear
  }
  const url = new URL(location.href)
  url.searchParams.delete('shared')
  url.searchParams.delete('why')
  history.replaceState(null, '', url)
}
