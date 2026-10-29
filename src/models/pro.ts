// MyMedia Pro: one licence bound to the Google account, bought on the web site
// with PayPal (api/models.ts). It unlocks the search of duplicates already
// there, blurry photos, sharing with more than FREE_SHARES people and
// transfers to another account.

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
}

/** People a free account may share its MyMedia with. */
export const FREE_SHARES = 2

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

function keep(email: string, s: ProStatus) {
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

/** Whether this account has Pro now. */
export const useIsPro = () => useApp((s) => !!s.pro?.pro)
