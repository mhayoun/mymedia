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

export async function shopModels(): Promise<ShopModel[]> {
  return (await call<{ models: ShopModel[] }>('GET', '')).models
}

export async function publishModel(input: PublishInput): Promise<ShopModel> {
  return (await call<{ model: ShopModel }>('POST', '', input)).model
}

export async function withdrawModel(id: string): Promise<void> {
  await call('DELETE', `?id=${encodeURIComponent(id)}`)
}

/** Gets a licence for this account (free while testing). */
export async function buyModel(id: string): Promise<void> {
  await call('POST', `?action=buy&id=${encodeURIComponent(id)}`)
}

export async function downloadModel(id: string): Promise<{ info: Omit<ShopModel, 'mine' | 'owned' | 'paymentsLive'>; buyer: string; data: ModelData }> {
  return call('GET', `?action=data&id=${encodeURIComponent(id)}`)
}

/** Whether this account may use the model. */
export async function checkLicence(id: string): Promise<{ ok: boolean; email: string }> {
  return call('GET', `?action=licence&id=${encodeURIComponent(id)}`)
}
