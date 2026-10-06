// Global app state (zustand). Device settings are persisted in localStorage.

import { create } from 'zustand'
import { DEFAULT_COMPRESS, type CompressSettings } from './lib/compressPlan'

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
  /** Move recognized media automatically when the model is confident. */
  classifyAuto: boolean
  /** Confidence (0..1) above which media are moved automatically. */
  thresholdHigh: number
  /** Confidence above which a suggestion is shown without "To check". */
  thresholdMedium: number
  compress: CompressSettings
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'he',
  rootName: 'MyMedia',
  syncMode: 'auto',
  syncIntervalMin: 15,
  view: 'grid',
  sort: 'newest',
  classifyAuto: true,
  thresholdHigh: 0.85,
  thresholdMedium: 0.6,
  compress: DEFAULT_COMPRESS,
}

const SETTINGS_KEY = 'mymedia.settings'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>
      const compress = { ...DEFAULT_COMPRESS, ...saved.compress, origins: { ...DEFAULT_COMPRESS.origins, ...saved.compress?.origins } }
      return { ...DEFAULT_SETTINGS, ...saved, compress }
    }
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
  /** Background learning progress (fingerprints of media). */
  indexing: { done: number; total: number } | null
  statsOpen: boolean
  /** Compression in progress. */
  compressing: { done: number; total: number; name: string; fileProgress: number; saved: number } | null
  /** Short message shown at the bottom of the screen (i18n key + values). */
  toast: { key: string; count?: number; bytes?: number } | null
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
  indexing: null,
  statsOpen: false,
  compressing: null,
  toast: null,
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
