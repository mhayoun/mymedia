// The shop of classification models (api/models.ts on MyMedia's server).

import { auth } from '../auth/google'

export interface ShopModel {
  id: string
  name: string
  description: string
  category: string
  seller: string
  price: number
  currency: string
  albums: number
  examples: number
  model: string
  createdAt: string
  /** Published by this account. */
  mine: boolean
  /** This account has a licence (or is the seller). */
  owned: boolean
  /** False while testing: everything is free. */
  paymentsLive: boolean
}

export interface Shop {
  models: ShopModel[]
  /** PayPal is plugged in on the server. */
  paymentsLive: boolean
  /** MyMedia's commission, in %. */
  fee: number
  /** This account pays the sellers out. */
  admin: boolean
}

/** Amounts by currency. */
export type Amounts = Record<string, number>

export interface MySales {
  count: number
  owed: Amounts
  paidOut: Amounts
  fee: number
  /** Each sale, newest first. */
  list: SaleLine[]
}

export interface SaleLine {
  /** The PayPal order. */
  order: string
  at: string
  model: string
  price: number
  currency: string
  /** MyMedia's commission. */
  fee: number
  /** What the seller gets. */
  share: number
  paidOut: string | null
  /** Paid with PayPal's test money (sandbox). */
  test: boolean
}

/** What MyMedia owes one seller in one currency. */
export interface Payout {
  seller: string
  sellerEmail: string
  paypal: string
  currency: string
  amount: number
  fees: number
  orders: string[]
  /** The oldest sale not paid out yet (sellers are paid within 7 days). */
  oldest: string
}

export interface ModelData {
  model: string
  dim: number
  albums: string[]
  labels: number[]
  vecs: string
}

export interface PublishInput extends ModelData {
  name: string
  description: string
  category: string
  seller: string
  /** The seller's PayPal account (needed for a price). */
  paypal: string
  price: number
  currency: string
}

export class ShopError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, query: string, body?: unknown, signedIn = true): Promise<T> {
  const headers: Record<string, string> = {}
  if (signedIn) headers.Authorization = `Bearer ${await auth.getToken()}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api/models${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const out = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ShopError(res.status, out.error ?? res.statusText)
  return out
}

export async function shopModels(): Promise<Shop> {
  return call<Shop>('GET', '')
}

export async function publishModel(input: PublishInput): Promise<ShopModel> {
  return (await call<{ model: ShopModel }>('POST', '', input)).model
}

export async function withdrawModel(id: string): Promise<void> {
  await call('DELETE', `?id=${encodeURIComponent(id)}`)
}

/**
 * Gets a licence for this account. A paid model gives instead the PayPal page
 * where the buyer pays; PayPal then sends them back to MyMedia (see `capturePayment`).
 */
export async function buyModel(id: string): Promise<{ ok: boolean; approve?: string }> {
  return call('POST', `?action=buy&id=${encodeURIComponent(id)}`)
}

/** Back from PayPal: takes the payment approved and gives the licence. */
export async function capturePayment(id: string, order: string): Promise<void> {
  await call('POST', `?action=capture&id=${encodeURIComponent(id)}&order=${encodeURIComponent(order)}`)
}

export async function downloadModel(id: string): Promise<{ info: Omit<ShopModel, 'mine' | 'owned' | 'paymentsLive'>; buyer: string; data: ModelData }> {
  return call('GET', `?action=data&id=${encodeURIComponent(id)}`)
}

/** This account's sales as a seller. */
export async function mySales(): Promise<MySales> {
  return call('GET', '?action=sales')
}

/** Admins: what MyMedia owes each seller. */
export async function payouts(): Promise<Payout[]> {
  return (await call<{ payouts: Payout[] }>('GET', '?action=payouts')).payouts
}

/** Admins: these sales' shares were sent to the seller. */
export async function markPaidOut(orders: string[]): Promise<void> {
  await call('POST', '?action=payout', { orders })
}

/** Whether this account may use the model. */
export async function checkLicence(id: string): Promise<{ ok: boolean; email: string }> {
  return call('GET', `?action=licence&id=${encodeURIComponent(id)}`)
}

export interface PaypalReturn {
  model: string
  order: string
  cancelled: boolean
}

/** The page PayPal sent the buyer back to (/?paypal=1&model=…&token=<order>), once; the address is then cleaned. */
export function paypalReturn(): PaypalReturn | null {
  const q = new URLSearchParams(location.search)
  if (!q.has('paypal')) return null
  const back = { model: q.get('model') ?? '', order: q.get('token') ?? '', cancelled: q.has('cancel') }
  history.replaceState(null, '', location.pathname)
  return back.model && back.order ? back : null
}
