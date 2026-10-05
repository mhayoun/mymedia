// Global app state (zustand). Device settings are persisted in localStorage.

import { create } from 'zustand'

export type Language = 'he' | 'fr' | 'en'
export type ViewMode = 'grid' | 'albums'
export type SortMode = 'newest' | 'oldest' | 'name'

export interface Settings {
  language: Language
  rootName: string
  syncMode: 'auto' | 'manual'
  syncIntervalMin: number
  view: ViewMode
  sort: SortMode
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'he',
  rootName: 'MyMedia',
  syncMode: 'auto',
  syncIntervalMin: 15,
  view: 'grid',
  sort: 'newest',
}

const SETTINGS_KEY = 'mymedia.settings'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // ignore: defaults
  }
  return DEFAULT_SETTINGS
}

export interface User {
  email: string
  name: string
  photo?: string
}

export interface SyncProgress {
  /** i18n key of the current step. */
  step: string
  done: number
  total: number
}

export type Phase = 'boot' | 'signedOut' | 'setup' | 'app' | 'rootMissing'

export interface Filters {
  categoryId: string | null
  /** "unfiled" = media directly in the root folder. */
  albumId: string | null
  type: 'all' | 'photo' | 'video'
}

interface AppState {
  phase: Phase
  user: User | null
  rootId: string | null
  settings: Settings
  sync: SyncProgress | null
  lastSyncAt: number | null
  error: string | null
  filters: Filters
  viewerId: string | null
  sidebarOpen: boolean
  settingsOpen: boolean
  set: (patch: Partial<Omit<AppState, 'set' | 'updateSettings' | 'setFilters'>>) => void
  updateSettings: (patch: Partial<Settings>) => void
  setFilters: (patch: Partial<Filters>) => void
}

export const useApp = create<AppState>((set, get) => ({
  phase: 'boot',
  user: null,
  rootId: null,
  settings: loadSettings(),
  sync: null,
  lastSyncAt: null,
  error: null,
  filters: { categoryId: null, albumId: null, type: 'all' },
  viewerId: null,
  sidebarOpen: false,
  settingsOpen: false,
  set: (patch) => set(patch),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Not persisted: still applied for this session.
    }
    set({ settings })
  },
  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
}))

export const app = () => useApp.getState()
