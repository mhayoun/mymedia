// MyMedia Pro: one licence bound to the Google account, bought on the web site
// with PayPal (api/models.ts). It unlocks the search of duplicates already
// there, blurry photos, sharing with more than FREE_SHARES people and
// transfers to another account.

import { auth, type FullProject } from '../auth/google'
import { app, useApp } from '../store'
import { call } from './shop'

export type ProPlan = 'year' | 'life'

export interface ProStatus {
  pro: boolean
  life: boolean
  /** Given by MyMedia (MYMEDIA_PRO), not bought. */
  offered?: boolean
  /** End of the paid years (ISO), if any. */
  until: string | null
  plans: { id: ProPlan; price: number; currency: string }[]
  /** PayPal is plugged in on the server (else Pro is given free, for tests). */
  paymentsLive: boolean
  /** Paid with PayPal's test money (sandbox). */
  test: boolean
  /** The account uses the full Drive access (MyMedia's full door), for good. Missing from an older server. */
  full?: boolean
  /**
   * The Google project of this account's full door: "MyMedia" (testers, accounts that already used it) or
   * MyMedia Pro (the others). Missing from an older server: "MyMedia".
   */
  fullProject?: FullProject
}

/**
 * People a free account may share its MyMedia with (by their Google account). None until Google's review:
 * each of them must open it by the full door, which takes one of its 100 places; free accounts share by a link.
 */
export const FREE_SHARES = 0

const cacheKey = (email: string) => `mymedia.pro.${email}`

/** The last status known for this account, for an instant (or offline) start. */
function cached(email: string): ProStatus | null {
  try {
    const s = JSON.parse(localStorage.getItem(cacheKey(email)) ?? 'null') as ProStatus | null
    // A year ended since: free again.
    return s && { ...s, pro: s.life || (!!s.until && s.until > new Date().toISOString()) }
  } catch {
    return null
  }
}

function keep(email: string, answer: ProStatus) {
  // An answer without the door (an older server) keeps the one known: else the full access would go
  // to the "MyMedia" project, in Testing, and Google would block an account of MyMedia Pro.
  const known = cached(email)
  const s: ProStatus = { ...answer, full: answer.full ?? known?.full, fullProject: answer.fullProject ?? known?.fullProject }
  try {
    localStorage.setItem(cacheKey(email), JSON.stringify(s))
  } catch {
    // Asked again at the next start.
  }
  app().set({ pro: s })
}

/** Asks the server; meanwhile (or offline) the last status known. */
export async function loadPro(email: string): Promise<void> {
  app().set({ pro: cached(email) })
  try {
    keep(email, await call<ProStatus>('GET', '?action=pro'))
  } catch (e) {
    console.warn('[MyMedia] Pro status unknown', e)
  }
}

/** Pro at once (tests without PayPal), or the PayPal page where the buyer pays (they then come back, see `capturePro`). */
export async function buyPro(email: string, plan: ProPlan): Promise<{ approve?: string }> {
  const r = await call<ProStatus & { ok: boolean; approve?: string }>('POST', `?action=buyPro&plan=${plan}`)
  if (r.ok) keep(email, r)
  return { approve: r.approve }
}

/** Back from PayPal: takes the payment approved and gives Pro. */
export async function capturePro(email: string, order: string): Promise<void> {
  keep(email, await call<ProStatus>('POST', `?action=capturePro&order=${encodeURIComponent(order)}`))
}

/**
 * Asks the server whether this account must use the full door (it used it once, or before the free door
 * existed). Null: the server cannot be asked.
 */
export async function usesFullDoor(email: string): Promise<boolean | null> {
  try {
    const s = await call<ProStatus>('GET', '?action=pro')
    keep(email, s)
    return s.full ?? false
  } catch (e) {
    console.warn('[MyMedia] door unknown', e)
    return null
  }
}

/** The project this account's full door must use (the server's word; "MyMedia" while MyMedia Pro is not set up). */
export function fullProjectFor(s: ProStatus | null = app().pro): FullProject {
  return s?.fullProject === 'pro' && auth.hasProProject ? 'pro' : 'mymedia'
}

/**
 * This device opens the account by "MyMedia" but the server moved it to MyMedia Pro (MYMEDIA_MOVE_TO_PRO,
 * or the move already made on another device): it must reconnect once through MyMedia Pro.
 */
export const useMoveToPro = () => useApp((s) => s.door === 'full' && !s.readOnly && fullProjectFor(s.pro) === 'pro' && auth.project !== 'pro')

/** Whether this account has Pro now. */
export const useIsPro = () => useApp((s) => !!s.pro?.pro)

/** Pro, and the full Drive access given (what transfers, imports from Drive and others' libraries need). */
export const useHasFullAccess = () => useApp((s) => s.door === 'full')
