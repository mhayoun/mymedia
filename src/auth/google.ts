// Google sign-in without any server, using Google Identity Services (token model).
//
// Tokens last one hour. When the token is about to expire, the next click in
// the app renews it silently (Google allows the renewal popup only after a
// user gesture). If it has already expired, Drive requests simply wait and a
// "Reconnect" banner is shown; nothing is lost and everything resumes after
// the click.
//
// In the Android app the phone's Google accounts give the token instead: once
// Drive access was accepted, a new one comes back without any click.
//
// Two doors (two Google projects): MyMedia Free asks only for the files MyMedia
// makes (no limit of accounts, no warning); the full door asks for the whole
// Drive (100 accounts until Google's review). A new account comes in by the
// free door; one that used the full door (the server knows) goes through it,
// for good. The Android app uses only the full door.
//
// The full door has two Google projects: "MyMedia" (the first one: testers and the accounts that already
// used it, and the Android app) and MyMedia Pro (a fresh 100 accounts, for those who move from Free to
// Pro). The server says which one an account takes (FullProject); a move to MyMedia Pro is never undone.

import { isNative, native } from '../native'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
export const FREE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export type Door = 'free' | 'full'
/** The Google project of the full door. */
export type FullProject = 'mymedia' | 'pro'

const doorKey = (email: string) => `mymedia.door.${email.toLowerCase()}`

/** The door this account used last on this device; an account used before the free door existed: full. */
export function savedDoor(email: string): Door | null {
  try {
    const d = localStorage.getItem(doorKey(email))
    return d === 'free' || d === 'full' ? d : null
  } catch {
    return null
  }
}

const projectKey = (email: string) => `mymedia.fullProject.${email.toLowerCase()}`

/** The full door's project this account used last on this device (before MyMedia Pro existed: "MyMedia"). */
export function savedProject(email: string | null): FullProject {
  try {
    return email && localStorage.getItem(projectKey(email)) === 'pro' ? 'pro' : 'mymedia'
  } catch {
    return 'mymedia'
  }
}

export function saveProject(email: string, project: FullProject): void {
  try {
    localStorage.setItem(projectKey(email), project)
  } catch {
    // Asked to the server again at the next start.
  }
}

export function saveDoor(email: string, door: Door): void {
  try {
    localStorage.setItem(doorKey(email), door)
  } catch {
    // Asked to the server again at the next start.
  }
}

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type: string; message?: string }) => void
  }): TokenClient
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } }
  }
}

interface StoredToken {
  accessToken: string
  expiresAt: number
  /** Missing in tokens kept before the free door existed: full. */
  door?: Door
  /** The full door's project (missing: "MyMedia"). */
  project?: FullProject
}

export type AuthStatus = 'signedOut' | 'signedIn' | 'needsReconnect'

const TOKEN_KEY = 'mymedia.token'
const HINT_KEY = 'mymedia.loginHint'
/** Renew on the next click when less than this remains. */
const RENEW_MARGIN_MS = 10 * 60 * 1000
/** Consider the token expired slightly early to avoid failing requests. */
const EXPIRY_MARGIN_MS = 60 * 1000
/** Android: how often the token is checked (and renewed without a click). */
const NATIVE_CHECK_MS = 60 * 1000

type Waiter = (token: string) => void

class GoogleAuth {
  private client: TokenClient | null = null
  private clientIds: Record<Door | 'pro', string> = { full: '', free: '', pro: '' }
  /** Which Google project the token comes from. */
  door: Door = 'full'
  /** With the full door: "MyMedia" or MyMedia Pro. */
  project: FullProject = 'mymedia'
  /** Asking the full access for an account that came by the free door: start again on it. */
  private upgrading: string | null = null
  private token: StoredToken | null = null
  private waiters: Waiter[] = []
  private listeners = new Set<() => void>()
  private requesting = false
  /** "Switch account": the token that comes back may be another account's. */
  private switching = false
  /** Goes up with each new token (to check which account it is). */
  serial = 0
  private lastError: string | null = null
  status: AuthStatus = 'signedOut'

  constructor() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY)
      if (raw) this.token = JSON.parse(raw) as StoredToken
    } catch {
      this.token = null
    }
  }

  get error(): string | null {
    return this.lastError
  }

  get loginHint(): string | null {
    try {
      return localStorage.getItem(HINT_KEY)
    } catch {
      return null
    }
  }

  set loginHint(email: string | null) {
    try {
      if (email) localStorage.setItem(HINT_KEY, email)
      else localStorage.removeItem(HINT_KEY)
    } catch {
      // Storage unavailable (private mode): the hint is only a convenience.
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private setStatus(status: AuthStatus) {
    if (this.status !== status) {
      this.status = status
      this.emit()
    }
  }

  /** The door for this account (null: a new sign-in, account not known yet). */
  doorFor(email: string | null): Door {
    if (isNative || !this.clientIds.free) return 'full'
    if (!email) return 'free'
    // Known on this device before the free door existed: it came by the full one.
    return savedDoor(email) ?? 'full'
  }

  /** MyMedia Pro is set up in config.json (else the full door is always "MyMedia"). */
  get hasProProject(): boolean {
    return !isNative && !!this.clientIds.pro
  }

  private useDoor(door: Door, project: FullProject = this.project) {
    if (!this.hasProProject) project = 'mymedia'
    if (this.door === door && this.project === project && this.client) return
    this.door = door
    this.project = project
    this.client = window.google!.accounts.oauth2.initTokenClient({
      client_id: door === 'free' ? this.clientIds.free : project === 'pro' ? this.clientIds.pro : this.clientIds.full,
      scope: door === 'full' ? DRIVE_SCOPE : FREE_SCOPE,
      callback: (r) => this.onToken(r),
      error_callback: (e) => {
        this.requesting = false
        this.switching = false
        this.upgrading = null
        // popup_closed / popup_failed_to_open: keep waiting, the banner stays.
        this.lastError = e.type
        if (this.waiters.length || !this.isValid()) this.setStatus(this.token || this.loginHint ? 'needsReconnect' : 'signedOut')
        this.emit()
      },
    })
  }

  async init(clientId: string, freeClientId = '', proClientId = ''): Promise<void> {
    this.clientIds = { full: clientId, free: freeClientId, pro: proClientId }
    // The kept token says which door it came by (e.g. after a switch of account).
    this.door = isNative || !freeClientId ? 'full' : this.isValid() ? (this.token!.door ?? 'full') : this.doorFor(this.loginHint)
    this.project = !this.hasProProject ? 'mymedia' : this.isValid() ? (this.token!.project ?? 'mymedia') : savedProject(this.loginHint)
    if (isNative) {
      setInterval(() => this.renewIfNeeded(), NATIVE_CHECK_MS)
      if (this.isValid()) this.setStatus('signedIn')
      else if (this.loginHint) {
        this.setStatus('needsReconnect')
        this.nativeRenew()
      }
      return
    }
    await loadScript('https://accounts.google.com/gsi/client')
    const door = this.door
    this.client = null
    this.useDoor(door, this.project)
    window.addEventListener('click', () => this.renewIfNeeded(), true)
    if (this.isValid()) this.setStatus('signedIn')
    else if (this.loginHint) this.setStatus('needsReconnect')
  }

  private isValid(): boolean {
    return !!this.token && this.token.expiresAt - EXPIRY_MARGIN_MS > Date.now()
  }

  private onToken(r: TokenResponse) {
    this.requesting = false
    const oauth2 = window.google!.accounts.oauth2
    if (r.error || !r.access_token) {
      this.lastError = r.error ?? 'unknown'
      this.setStatus(this.loginHint ? 'needsReconnect' : 'signedOut')
      this.emit()
      return
    }
    if (!oauth2.hasGrantedAllScopes(r, this.door === 'full' ? DRIVE_SCOPE : FREE_SCOPE)) {
      this.upgrading = null
      this.lastError = 'scope_denied'
      this.setStatus('signedOut')
      this.emit()
      return
    }
    this.accept(r.access_token, Number(r.expires_in ?? 3600))
  }

  private accept(accessToken: string, expiresIn: number) {
    this.lastError = null
    this.serial++
    this.token = { accessToken, expiresAt: Date.now() + expiresIn * 1000, door: this.door, ...(this.door === 'full' && this.project === 'pro' ? { project: 'pro' as const } : {}) }
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token))
    } catch {
      // Not persisted: the user will reconnect after a restart.
    }
    if (this.upgrading) {
      // The same account, now by the full door: the app starts again on it.
      saveDoor(this.upgrading, 'full')
      saveProject(this.upgrading, this.project)
      this.loginHint = this.upgrading
      location.reload()
      return
    }
    if (this.switching) {
      // Nothing of the open account may run with the new one: start again on it.
      this.loginHint = null
      location.reload()
      return
    }
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w(accessToken)
    this.setStatus('signedIn')
    this.emit()
  }

  /** Must be called from a click handler (opens Google's popup). */
  signIn(chooseAccount = false) {
    if (isNative) return void this.nativeSignIn(chooseAccount)
    if (!this.client) return
    // Another account (not known yet): by the free door; the server then says if it must take the full one.
    if (chooseAccount || !this.loginHint) this.useDoor(this.doorFor(null))
    this.requesting = true
    this.switching = chooseAccount && !!this.loginHint
    const hint = this.loginHint
    this.client.requestAccessToken(
      chooseAccount || !hint ? { prompt: 'select_account' } : { prompt: '', login_hint: hint },
    )
  }

  /** Opens MyMedia on another account already used here (Google asks only if needed). */
  switchTo(email: string) {
    if (isNative) {
      this.switching = true
      return void this.nativeAuthorize(email, true)
    }
    if (!this.client) return
    this.useDoor(this.doorFor(email), savedProject(email))
    this.requesting = true
    this.switching = true
    this.client.requestAccessToken({ prompt: '', login_hint: email })
  }

  /**
   * Must be called from a click: this account gives the full Drive access through `project` (the one the
   * server gave it): from the free door, or from "MyMedia" to MyMedia Pro. Google shows that project's
   * screen; then the app starts again on it.
   */
  upgrade(email: string, project: FullProject = 'mymedia') {
    if (isNative || !this.client) return
    if (!this.clientIds.free && !(project === 'pro' && this.hasProProject)) return
    this.useDoor('full', project)
    this.requesting = true
    this.upgrading = email
    this.client.requestAccessToken({ prompt: 'consent', login_hint: email })
  }

  private renewIfNeeded() {
    if (isNative) {
      if (!this.token || this.token.expiresAt - RENEW_MARGIN_MS < Date.now()) this.nativeRenew()
      return
    }
    if (!this.client || this.requesting || !this.loginHint) return
    if (this.token && this.token.expiresAt - RENEW_MARGIN_MS > Date.now()) return
    this.signIn()
  }

  /**
   * Before a long task (call it from the click that starts it): renews now
   * if the token would expire during the task, so it does not stop halfway.
   */
  renewBefore(taskMs: number) {
    // Android renews by itself during the task.
    if (isNative) return
    if (!this.client || this.requesting || !this.loginHint) return
    if (this.token && this.token.expiresAt - EXPIRY_MARGIN_MS - taskMs > Date.now()) return
    this.signIn()
  }

  /** Returns a valid access token, waiting for the user to reconnect if needed. */
  getToken(): Promise<string> {
    if (this.isValid()) return Promise.resolve(this.token!.accessToken)
    const waiting = new Promise<string>((resolve) => this.waiters.push(resolve))
    if (isNative && this.loginHint) this.nativeRenew()
    else this.setStatus(this.loginHint ? 'needsReconnect' : 'signedOut')
    return waiting
  }

  /** Called when Google rejects the token (401). */
  invalidate() {
    if (isNative && this.token) void native.clearToken({ token: this.token.accessToken })
    this.token = null
    try {
      localStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
  }

  /** Forgets the account on this device only (no revoke: other devices stay connected). */
  signOut() {
    this.invalidate()
    this.loginHint = null
    this.setStatus('signedOut')
  }

  // ---- Android ----

  /** A new token without any click; if Google needs the user, the "Reconnect" banner is shown. */
  private nativeRenew() {
    if (!this.requesting && this.loginHint) void this.nativeAuthorize(this.loginHint, false)
  }

  private async nativeSignIn(chooseAccount: boolean) {
    let email = this.loginHint
    if (chooseAccount || !email) {
      try {
        email = (await native.chooseAccount()).email
      } catch (e) {
        this.fail(e)
        return
      }
      // Another account: nothing of the open one may run with it.
      this.switching = !!this.loginHint && email !== this.loginHint
    }
    await this.nativeAuthorize(email, true)
  }

  private async nativeAuthorize(email: string, interactive: boolean) {
    if (this.requesting) return
    this.requesting = true
    try {
      const { accessToken } = await native.authorize({ email, interactive })
      this.requesting = false
      if (!this.loginHint) this.loginHint = email
      this.accept(accessToken, await expiresIn(accessToken))
    } catch (e) {
      this.requesting = false
      this.switching = false
      this.fail(e)
    }
  }

  private fail(e: unknown) {
    const code = (e as { code?: string }).code
    // needs_ui: Google wants the user (first time, access removed): the banner's button asks.
    this.lastError = code === 'needs_ui' ? null : (code ?? 'unknown')
    if (code === 'scope_denied') this.setStatus('signedOut')
    else if (this.waiters.length || !this.isValid()) this.setStatus(this.token || this.loginHint ? 'needsReconnect' : 'signedOut')
    this.emit()
  }
}

/** Seconds left on a token given by Android (which does not say); one hour if Google cannot be asked. */
async function expiresIn(token: string): Promise<number> {
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo', { method: 'POST', body: new URLSearchParams({ access_token: token }) })
    const n = Number(((await r.json()) as { expires_in?: string }).expires_in)
    if (n > 0) return n
  } catch {
    // Offline: assume a fresh token.
  }
  return 3600
}

export const auth = new GoogleAuth()

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.google?.accounts) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load Google sign-in (offline?)'))
    document.head.appendChild(s)
  })
}
