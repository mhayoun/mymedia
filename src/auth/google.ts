// Google sign-in without any server, using Google Identity Services (token model).
//
// Tokens last one hour. When the token is about to expire, the next click in
// the app renews it silently (Google allows the renewal popup only after a
// user gesture). If it has already expired, Drive requests simply wait and a
// "Reconnect" banner is shown; nothing is lost and everything resumes after
// the click.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

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
}

export type AuthStatus = 'signedOut' | 'signedIn' | 'needsReconnect'

const TOKEN_KEY = 'mymedia.token'
const HINT_KEY = 'mymedia.loginHint'
/** Renew on the next click when less than this remains. */
const RENEW_MARGIN_MS = 10 * 60 * 1000
/** Consider the token expired slightly early to avoid failing requests. */
const EXPIRY_MARGIN_MS = 60 * 1000

type Waiter = (token: string) => void

class GoogleAuth {
  private client: TokenClient | null = null
  private token: StoredToken | null = null
  private waiters: Waiter[] = []
  private listeners = new Set<() => void>()
  private requesting = false
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

  async init(clientId: string): Promise<void> {
    await loadScript('https://accounts.google.com/gsi/client')
    const oauth2 = window.google!.accounts.oauth2
    this.client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => this.onToken(r),
      error_callback: (e) => {
        this.requesting = false
        // popup_closed / popup_failed_to_open: keep waiting, the banner stays.
        this.lastError = e.type
        if (this.waiters.length || !this.isValid()) this.setStatus(this.token || this.loginHint ? 'needsReconnect' : 'signedOut')
        this.emit()
      },
    })
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
    if (!oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
      this.lastError = 'scope_denied'
      this.setStatus('signedOut')
      this.emit()
      return
    }
    this.lastError = null
    this.token = { accessToken: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 }
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token))
    } catch {
      // Not persisted: the user will reconnect after a restart.
    }
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w(r.access_token)
    this.setStatus('signedIn')
    this.emit()
  }

  /** Must be called from a click handler (opens Google's popup). */
  signIn(chooseAccount = false) {
    if (!this.client) return
    this.requesting = true
    const hint = this.loginHint
    this.client.requestAccessToken(
      chooseAccount || !hint ? { prompt: 'select_account' } : { prompt: '', login_hint: hint },
    )
  }

  private renewIfNeeded() {
    if (!this.client || this.requesting || !this.loginHint) return
    if (this.token && this.token.expiresAt - RENEW_MARGIN_MS > Date.now()) return
    this.signIn()
  }

  /** Returns a valid access token, waiting for the user to reconnect if needed. */
  getToken(): Promise<string> {
    if (this.isValid()) return Promise.resolve(this.token!.accessToken)
    this.setStatus(this.loginHint ? 'needsReconnect' : 'signedOut')
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  /** Called when Google rejects the token (401). */
  invalidate() {
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
