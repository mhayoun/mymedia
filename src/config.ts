// Runtime configuration read from public/config.json, so the Google client ID
// can be changed without rebuilding the app.

export interface AppConfig {
  googleClientId: string
}

const CACHE_KEY = 'mymedia.config'

export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    const cfg = (await res.json()) as AppConfig
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cfg))
    } catch {
      // ignore
    }
    return cfg
  } catch {
    // Offline: use the last known configuration.
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) return JSON.parse(raw) as AppConfig
    } catch {
      // ignore
    }
    return { googleClientId: '' }
  }
}

export function isConfigured(cfg: AppConfig): boolean {
  return /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(cfg.googleClientId.trim())
}
