// App start-up and sign-in flow.

import { auth } from './auth/google'
import { isConfigured, loadConfig } from './config'
import { loadUser, locateRoot, openCachedUser, syncNow } from './sync/engine'
import { app } from './store'

let sessionStarted = false

export type BootResult = 'ok' | 'notConfigured'

export async function boot(): Promise<BootResult> {
  const cfg = await loadConfig()
  if (!isConfigured(cfg)) return 'notConfigured'

  // Show the last account's saved gallery immediately (also works offline).
  const hint = auth.loginHint
  const cached = hint ? await openCachedUser(hint).catch(() => false) : false
  if (cached) app().set({ phase: 'app' })

  try {
    await auth.init(cfg.googleClientId)
  } catch (e) {
    // Offline: Google's script cannot load. Cached browsing still works.
    console.warn('[MyMedia]', e)
  }

  auth.subscribe(() => {
    if (auth.status === 'signedIn' && !sessionStarted) void startSession()
  })

  if (cached) {
    // Requests wait for a valid token; if it has expired, the Reconnect banner shows.
    void startSession()
  } else if (auth.status === 'signedIn') {
    void startSession()
  } else {
    app().set({ phase: 'signedOut' })
  }
  return 'ok'
}

export async function startSession(): Promise<void> {
  if (sessionStarted) return
  sessionStarted = true
  try {
    const previous = app().user?.email
    await loadUser()
    if (previous && previous !== app().user?.email) {
      app().set({ rootId: null, filters: { categoryId: null, albumId: null, type: 'all' } })
    }
    const root = await locateRoot()
    if (root === 'missing') {
      app().set({ phase: 'setup' })
      return
    }
    if (root === 'removed') {
      app().set({ phase: 'rootMissing' })
      return
    }
    app().set({ phase: 'app' })
    await syncNow()
  } catch (e) {
    console.error('[MyMedia] session start failed', e)
    app().set({ error: 'errors.syncFailed' })
    sessionStarted = false
  }
}

/** After the root folder was created or restored. */
export async function rootReady(): Promise<void> {
  const root = await locateRoot()
  if (root !== 'found') return
  app().set({ phase: 'app' })
  await syncNow({ full: true })
}

export function signOut() {
  auth.signOut()
  sessionStarted = false
  app().set({ phase: 'signedOut', user: null, rootId: null, viewerId: null, settingsOpen: false })
}
