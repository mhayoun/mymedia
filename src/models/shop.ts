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

function base64ToBytes(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** As the server's `pack`: JSON length (4 bytes), JSON, fingerprints as bytes. */
function pack(head: unknown, bytes: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(head))
  const out = new Uint8Array(4 + text.length + bytes.length)
  new DataView(out.buffer).setUint32(0, text.length)
  out.set(text, 4)
  out.set(bytes, 4 + text.length)
  return out
}

/** Fingerprints go as bytes (a third smaller than base64): more of them fit in a request. */
export async function publishModel(input: PublishInput): Promise<ShopModel> {
  const { vecs, ...head } = input
  const res = await fetch('/api/models', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await auth.getToken()}`, 'Content-Type': 'application/octet-stream' },
    body: pack(head, base64ToBytes(vecs)) as BodyInit,
  })
  const out = (await res.json().catch(() => ({}))) as { model: ShopModel; error?: string }
  if (!res.ok) throw new ShopError(res.status, out.error ?? res.statusText)
  return out.model
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

type Downloaded = { info: Omit<ShopModel, 'mine' | 'owned' | 'paymentsLive'>; buyer: string; data: ModelData }

export async function downloadModel(id: string): Promise<Downloaded> {
  const res = await fetch(`/api/models?action=data&format=bin&id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${await auth.getToken()}` },
  })
  if (!res.ok) {
    const out = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ShopError(res.status, out.error ?? res.statusText)
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0)
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + n))) as Omit<Downloaded, 'data'> & { data: Omit<ModelData, 'vecs'> }
  return { ...head, data: { ...head.data, vecs: bytesToBase64(buf.subarray(4 + n)) } }
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
