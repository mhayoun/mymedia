// Global app state (zustand). Device settings are persisted in localStorage.

import { create } from 'zustand'
import type { Outcome, Planned } from './compress/engine'
import { DEFAULT_COMPRESS, type CompressSettings } from './lib/compressPlan'
import type { PaypalReturn } from './models/shop'
import type { ProStatus } from './models/pro'

export type Language = 'he' | 'fr' | 'en'
/** Gallery: all together, or under headings by album, year or month. */
export type ViewMode = 'grid' | 'albums' | 'years' | 'months'
export type SortMode = 'newest' | 'oldest' | 'name' | 'largest' | 'smallest'

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
  /** Face recognition (on the device only). */
  facesEnabled: boolean
  /** Computer: the side menu (categories and albums) is closed; the ☰ button opens it again. */
  sidebarHidden?: boolean
  /** Computer: width of the side menu in pixels, set by dragging its edge. */
  sidebarWidth?: number
  /** Thumbnail packs used on this device (off: one by one, as before them). */
  thumbPacks?: boolean
  /** 3: the grid became the default again (earlier saved settings are moved to it once). */
  viewDefault?: number
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
  facesEnabled: true,
  viewDefault: 3,
}

const SETTINGS_KEY = 'mymedia.settings'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>
      const compress = { ...DEFAULT_COMPRESS, ...saved.compress, origins: { ...DEFAULT_COMPRESS.origins, ...saved.compress?.origins } }
      // The grid is the default again: shown once to everyone, then their choice is kept.
      const view = saved.viewDefault === 3 ? (saved.view ?? DEFAULT_SETTINGS.view) : DEFAULT_SETTINGS.view
      return { ...DEFAULT_SETTINGS, ...saved, compress, view, viewDefault: 3 }
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
  /** Only media showing this person. */
  personId?: string | null
  /** Only media from this Facebook group or import (key from lib/provenance). */
  provenance?: string | null
  /** Search words (name, description, album, people, species). */
  query?: string
  origin?: import('./lib/media').Origin | null
  status?: 'classified' | 'toClassify' | 'toCheck' | 'auto' | null
  compression?: import('./lib/search').CompressionState | null
  /** Date taken: a year "2024" or a month "2024-03" (lib/periods). */
  period?: string | null
}

interface AppState {
  phase: Phase
  user: User | null
  rootId: string | null
  /** A MyMedia another account shared with this one (null: the user's own). */
  shared: { ownerName?: string; ownerEmail?: string } | null
  /** Shared for viewing only: browse, search and watch; nothing can be changed. */
  readOnly: boolean
  settings: Settings
  sync: SyncProgress | null
  /** Background step shown with a spinner (i18n key): preparing the analysis, sorting… */
  working: string | null
  /** Photos moved here, not yet in their new folder on Drive. */
  moving: number
  /** Background learning progress (fingerprints of media). */
  indexing: { done: number; total: number } | null
  statsOpen: boolean
  /** Compression in progress. */
  compressing: { done: number; total: number; name: string; fileProgress: number; saved: number } | null
  /** New files proposed for compression after a load (the user ticks which ones). */
  compressOffer: Planned[] | null
  /** Result of each file in the current/last compression run. */
  compressOutcome: Record<string, Outcome>
  /** Short message shown at the bottom of the screen (i18n key + values). */
  toast: { key: string; count?: number; bytes?: number; detail?: string } | null
  lastSyncAt: number | null
  error: string | null
  filters: Filters
  viewerId: string | null
  /** Selected media in selection mode; null = not selecting. */
  selection: string[] | null
  sidebarOpen: boolean
  settingsOpen: boolean
  accountOpen: boolean
  /** The libraries window (mine and those shared with me), from the eye button. */
  libraryOpen: boolean
  /** The models window: those in use and the shop ('shop' or true), or publishing one's own. */
  shopOpen: boolean | 'shop' | 'publish'
  /** The Share window (my MyMedia to others) or the View one (the MyMedia of others). */
  shareOpen: false | 'share' | 'view'
  /** Back from PayPal: the shop finishes the purchase. */
  shopResume: PaypalReturn | null
  /** This account's MyMedia Pro (null: not known yet, so free). */
  pro: ProStatus | null
  /** The MyMedia Pro window. */
  proOpen: boolean
  /** Back from paying Pro on PayPal: the Pro window finishes the purchase. */
  proResume: PaypalReturn | null
  helpOpen: boolean
  speedOpen: boolean
  activityOpen: boolean
  set: (patch: Partial<Omit<AppState, 'set' | 'updateSettings' | 'setFilters'>>) => void
  updateSettings: (patch: Partial<Settings>) => void
  setFilters: (patch: Partial<Filters>) => void
}

export const useApp = create<AppState>((set, get) => ({
  phase: 'boot',
  user: null,
  rootId: null,
  shared: null,
  readOnly: false,
  settings: loadSettings(),
  sync: null,
  moving: 0,
  working: null,
  indexing: null,
  statsOpen: false,
  compressing: null,
  compressOffer: null,
  compressOutcome: {},
  toast: null,
  lastSyncAt: null,
  error: null,
  filters: { categoryId: null, albumId: null, type: 'all' },
  viewerId: null,
  selection: null,
  sidebarOpen: false,
  settingsOpen: false,
  accountOpen: false,
  libraryOpen: false,
  shopOpen: false,
  shareOpen: false,
  shopResume: null,
  pro: null,
  proOpen: false,
  proResume: null,
  helpOpen: false,
  speedOpen: false,
  activityOpen: false,
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

const steps: string[] = []
/** Shows `key` in the top bar while `fn` runs (the latest step started wins). */
export async function withStep<T>(key: string, fn: () => Promise<T>): Promise<T> {
  steps.push(key)
  app().set({ working: key })
  try {
    return await fn()
  } finally {
    steps.splice(steps.lastIndexOf(key), 1)
    app().set({ working: steps[steps.length - 1] ?? null })
  }
}
