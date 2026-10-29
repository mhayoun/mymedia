// The Android app (Capacitor): the same web app inside a native shell, which
// adds Google sign-in through the phone's accounts and the Share menu
// (android/app/src/main/java/com/mediakeep/app/MyMediaPlugin.java).

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()

export interface NativeSharedFile {
  path: string
  name: string
  type: string | null
  modified: number
}

interface MyMediaPlugin {
  /** A Drive access token; interactive: may show Google's screen (else rejects with code "needs_ui"). */
  authorize(options: { email?: string; interactive?: boolean }): Promise<{ accessToken: string }>
  /** The phone's account chooser. */
  chooseAccount(): Promise<{ email: string }>
  clearToken(options: { token: string }): Promise<void>
  getShared(): Promise<{ files: NativeSharedFile[] }>
  clearShared(): Promise<void>
  addListener(event: 'shared', fn: () => void): Promise<PluginListenerHandle>
}

export const native = registerPlugin<MyMediaPlugin>('MyMedia')

/** Where the server functions are: the site itself, or the web site from the Android app. */
export const apiBase = isNative ? 'https://media-keep.vercel.app' : ''
