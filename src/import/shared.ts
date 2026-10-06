// Files received from the phone's Share menu (stored by the service worker).

const SHARED_CACHE = 'mymedia-shared'

export function hasSharedFiles(): boolean {
  return new URLSearchParams(location.search).has('shared')
}

export async function readSharedFiles(): Promise<File[]> {
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
  try {
    await caches.delete(SHARED_CACHE)
  } catch {
    // nothing to clear
  }
  const url = new URL(location.href)
  url.searchParams.delete('shared')
  history.replaceState(null, '', url)
}
