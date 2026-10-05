import { useEffect, useSyncExternalStore } from 'react'
import { auth, type AuthStatus } from '../auth/google'
import { syncNow } from '../sync/engine'
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

/** Automatic mode: check Drive regularly while the app is open and visible. */
export function useAutoSync() {
  const mode = useApp((s) => s.settings.syncMode)
  const minutes = useApp((s) => s.settings.syncIntervalMin)
  const phase = useApp((s) => s.phase)
  useEffect(() => {
    if (mode !== 'auto' || phase !== 'app') return
    const intervalMs = Math.max(1, minutes) * 60 * 1000
    const due = () => {
      const last = useApp.getState().lastSyncAt ?? 0
      return Date.now() - last >= intervalMs
    }
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && due()) void syncNow()
    }
    const timer = setInterval(tick, 30 * 1000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
  }, [mode, minutes, phase])
}
