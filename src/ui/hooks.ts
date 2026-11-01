import { useEffect, useSyncExternalStore } from 'react'
import { auth, type AuthStatus } from '../auth/google'
import { isAutoSyncHeld, syncNow } from '../sync/engine'
import { useApp } from '../store'

export function useAuthStatus(): AuthStatus {
  return useSyncExternalStore(
    (cb) => auth.subscribe(cb),
    () => auth.status,
  )
}

export function useAuthError(): string | null {
  return useSyncExternalStore(
    (cb) => auth.subscribe(cb),
    () => auth.error,
  )
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => navigator.onLine,
  )
}

/** Automatic mode, back on the app: Drive is checked again when the last check is older than this. */
const RETURN_MS = 60 * 1000

/** Automatic mode: check Drive regularly while the app is open and visible. */
export function useAutoSync() {
  const mode = useApp((s) => s.settings.syncMode)
  const minutes = useApp((s) => s.settings.syncIntervalMin)
  const phase = useApp((s) => s.phase)
  useEffect(() => {
    if (mode !== 'auto' || phase !== 'app') return
    const intervalMs = Math.max(1, minutes) * 60 * 1000
    const due = (ms: number) => {
      const last = useApp.getState().lastSyncAt ?? 0
      return Date.now() - last >= ms
    }
    const check = (ms: number) => {
      if (document.visibilityState === 'visible' && navigator.onLine && due(ms) && !isAutoSyncHeld()) void syncNow()
    }
    const tick = () => check(intervalMs)
    // Back on the app (e.g. after importing from the Android app, its tab was paused): sooner.
    const back = () => check(Math.min(intervalMs, RETURN_MS))
    const timer = setInterval(tick, 30 * 1000)
    document.addEventListener('visibilitychange', back)
    window.addEventListener('online', back)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('online', back)
    }
  }, [mode, minutes, phase])
}
