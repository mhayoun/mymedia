// Google's own window to choose files in Google Drive (Google Picker). With the access of MyMedia Free (only
// the files MyMedia makes or is given), the photos chosen there become MyMedia's to read and move. A folder
// chosen gives only the folder, not what it holds: the photos themselves are chosen (Ctrl+A in the folder).

import { auth } from '../auth/google'

const SCRIPT = 'https://apis.google.com/js/api.js'

/* Only what MyMedia uses of Google's script. */
interface PickerDoc {
  id: string
  name?: string
  mimeType?: string
  parentId?: string
}
interface PickerResult {
  action: string
  docs?: PickerDoc[]
}
interface PickerView {
  setOwnedByMe(on: boolean): PickerView
  setIncludeFolders(on: boolean): PickerView
  setMode(mode: string): PickerView
}
interface PickerBuilder {
  addView(v: PickerView): PickerBuilder
  enableFeature(f: string): PickerBuilder
  setOAuthToken(t: string): PickerBuilder
  setDeveloperKey(k: string): PickerBuilder
  setAppId(id: string): PickerBuilder
  setLocale(l: string): PickerBuilder
  setTitle(t: string): PickerBuilder
  setMaxItems(n: number): PickerBuilder
  setCallback(cb: (r: PickerResult) => void): PickerBuilder
  build(): { setVisible(on: boolean): void }
}
interface PickerApi {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId: string) => PickerView
  ViewId: { DOCS_IMAGES_AND_VIDEOS: string }
  DocsViewMode: { GRID: string; LIST: string }
  Feature: { MULTISELECT_ENABLED: string }
  Action: { PICKED: string; CANCEL: string }
}
declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void }
  }
}
const pickerApi = () => (window.google as unknown as { picker?: PickerApi } | undefined)?.picker

let loading: Promise<void> | null = null

/** Loads Google's script once (called when the window that uses it opens, so the click opens it at once). */
export function loadPicker(): Promise<void> {
  if (pickerApi()) return Promise.resolve()
  loading ??= new Promise<void>((resolve, reject) => {
    const ready = () => window.gapi!.load('picker', () => resolve())
    if (window.gapi) return ready()
    const s = document.createElement('script')
    s.src = SCRIPT
    s.async = true
    s.onload = ready
    s.onerror = () => {
      loading = null
      reject(new Error('Google Picker script not loaded'))
    }
    document.head.append(s)
  })
  return loading
}

export interface Picked {
  id: string
  name: string
  mimeType: string
  /** The folder it was in, as Google's window tells it. */
  parentId?: string
}

/**
 * Opens Google's window on the photos and videos of the user's own Drive; null when it is closed. As a list
 * (name, date, size): inside MyMedia, Google's window often cannot show its pictures (empty squares).
 */
export async function pickMyDriveMedia(apiKey: string, opts: { locale: string; title: string }): Promise<Picked[] | null> {
  await loadPicker()
  const token = await auth.getToken()
  const p = pickerApi()!
  const view = new p.DocsView(p.ViewId.DOCS_IMAGES_AND_VIDEOS).setOwnedByMe(true).setIncludeFolders(true).setMode(p.DocsViewMode.LIST)
  return new Promise((resolve) => {
    let b = new p.PickerBuilder()
      .addView(view)
      .enableFeature(p.Feature.MULTISELECT_ENABLED)
      .setMaxItems(10000)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setLocale(opts.locale)
      .setTitle(opts.title)
      .setCallback((r) => {
        if (r.action === p.Action.CANCEL) resolve(null)
        else if (r.action === p.Action.PICKED)
          resolve((r.docs ?? []).map((d) => ({ id: d.id, name: d.name ?? '', mimeType: d.mimeType ?? '', parentId: d.parentId })))
      })
    // The project the token comes from: the files chosen are given to it.
    const appId = auth.projectNumber
    if (appId) b = b.setAppId(appId)
    b.build().setVisible(true)
  })
}
