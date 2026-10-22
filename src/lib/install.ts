// Installing MyMedia as an app: Chrome and Edge offer it by an event, kept
// here (it fires once, early) for the menu's Install button; elsewhere
// (iPhone Safari, Firefox) the user is told how to add it to the home screen.

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

export function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPrompt
    changed()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    changed()
  })
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True when the browser can install it with one tap. */
export function canPromptInstall(): boolean {
  return deferred !== null
}

/** The browser's install window; false when there is none (the user is then told how). */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  changed()
  await e.prompt()
  await e.userChoice.catch(() => undefined)
  return true
}

export type InstallHow = 'ios' | 'android' | 'desktop'

export function installHow(): InstallHow {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return /Android/i.test(ua) ? 'android' : 'desktop'
}
