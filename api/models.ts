// MyMedia's only server: the shop of classification models.
//
// A seller publishes the fingerprints of the photos of one category (album
// names + vectors, never the photos). A buyer gets a licence bound to their
// Google account, then downloads the model into their own Drive. Their
// MyMedia asks here whether the licence is valid before using it, so a model
// copied to another account is refused.
//
// Store (Vercel Blob, private):
//   models/<id>/info.json      what the shop shows (+ the seller's account)
//   models/<id>/data.json      album names, labels, vectors
//   licences/<id>/<hash>.json  one per buyer account
//
//   GET    /api/models                      shop
//   POST   /api/models                      publish (body: PublishBody)
//   DELETE /api/models?id=                  withdraw (seller only)
//   POST   /api/models?action=buy&id=       get a licence (free while testing)
//   GET    /api/models?action=data&id=      the model (seller or licence)
//   GET    /api/models?action=licence&id=   is this account's licence valid

import { del, get, list, put } from '@vercel/blob'
import { createHash, randomUUID } from 'node:crypto'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '246067015646-63ga5nqjgihi3sd8mmb3ch0urb0i1q5m.apps.googleusercontent.com'
/** Payments are not plugged in yet: every model is free while testing. */
const PAYMENTS_LIVE = false
// Vercel takes 4.5 MB a request: 4,000 fingerprints (≈ 4.1 MB in base64).
const MAX_EXAMPLES = 4000
const DIM = 768

interface ModelInfo {
  id: string
  name: string
  description: string
  category: string
  seller: string
  sellerEmail: string
  price: number
  currency: string
  albums: number
  examples: number
  model: string
  createdAt: string
}

interface ModelData {
  model: string
  dim: number
  /** Album names, under the category. */
  albums: string[]
  /** For each vector, its index in `albums`. */
  labels: number[]
  /** Int8 vectors, `dim` bytes each, base64. */
  vecs: string
}

interface PublishBody extends ModelData {
  name: string
  description?: string
  category: string
  seller: string
  price: number
  currency?: string
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

// ---- Who is asking -----------------------------------------------------------

const known = new Map<string, { email: string; until: number }>()

/** The Google account of the request: a MyMedia access token, checked with Google. */
async function account(req: Request): Promise<string> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'sign in')
  const hit = known.get(token)
  if (hit && hit.until > Date.now()) return hit.email
  const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
  if (!info.ok) throw new HttpError(401, 'invalid token')
  const t = (await info.json()) as { aud?: string; azp?: string; expires_in?: string }
  if (t.aud !== CLIENT_ID && t.azp !== CLIENT_ID) throw new HttpError(401, 'token of another app')
  const about = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!about.ok) throw new HttpError(401, 'account unknown')
  const email = ((await about.json()) as { user?: { emailAddress?: string } }).user?.emailAddress?.toLowerCase()
  if (!email) throw new HttpError(401, 'account unknown')
  known.set(token, { email, until: Date.now() + Math.min(Number(t.expires_in ?? 600), 600) * 1000 })
  return email
}

async function optionalAccount(req: Request): Promise<string | null> {
  try {
    return await account(req)
  } catch {
    return null
  }
}

// ---- Store -------------------------------------------------------------------

async function readJson<T>(pathname: string): Promise<T | null> {
  const r = await get(pathname, { access: 'private', useCache: false })
  if (!r || r.statusCode !== 200) return null
  return (await new Response(r.stream).json()) as T
}

function writeJson(pathname: string, body: unknown) {
  return put(pathname, JSON.stringify(body), { access: 'private', contentType: 'application/json', allowOverwrite: true, addRandomSuffix: false })
}

const licencePath = (id: string, email: string) => `licences/${id}/${createHash('sha256').update(email).digest('hex').slice(0, 32)}.json`
const validId = (id: string | null): string => {
  if (!id || !/^[a-z0-9-]{8,64}$/.test(id)) throw new HttpError(400, 'bad id')
  return id
}

async function info(id: string): Promise<ModelInfo> {
  const i = await readJson<ModelInfo>(`models/${id}/info.json`)
  if (!i) throw new HttpError(404, 'model not found')
  return i
}

async function hasLicence(i: ModelInfo, email: string): Promise<boolean> {
  return i.sellerEmail === email || !!(await readJson(licencePath(i.id, email)))
}

/** What the shop shows of a model (the seller's account stays private). */
function shown(i: ModelInfo, email: string | null, owned: boolean) {
  const { sellerEmail, ...rest } = i
  return { ...rest, mine: sellerEmail === email, owned, paymentsLive: PAYMENTS_LIVE }
}

// ---- Actions -----------------------------------------------------------------

async function shop(req: Request) {
  const email = await optionalAccount(req)
  const out = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix: 'models/', cursor })
    for (const b of page.blobs) {
      if (!b.pathname.endsWith('/info.json')) continue
      const i = await readJson<ModelInfo>(b.pathname)
      if (i) out.push(shown(i, email, email ? await hasLicence(i, email) : false))
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return json({ models: out })
}

async function publish(req: Request) {
  const email = await account(req)
  const b = (await req.json()) as PublishBody
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const name = text(b.name, 80)
  const category = text(b.category, 80)
  const seller = text(b.seller, 80)
  if (!name || !category || !seller) throw new HttpError(400, 'name, category and seller are required')
  const price = Number(b.price)
  if (!Number.isFinite(price) || price < 0 || price > 10000) throw new HttpError(400, 'bad price')
  if (b.dim !== DIM || typeof b.model !== 'string') throw new HttpError(400, 'bad model')
  const albums = Array.isArray(b.albums) ? b.albums.map((a) => text(a, 120)) : []
  const labels = Array.isArray(b.labels) ? b.labels : []
  const bytes = Buffer.from(typeof b.vecs === 'string' ? b.vecs : '', 'base64')
  if (!albums.length || !labels.length || labels.length > MAX_EXAMPLES || bytes.length !== labels.length * DIM) throw new HttpError(400, 'bad data')
  if (labels.some((l) => !Number.isInteger(l) || l < 0 || l >= albums.length)) throw new HttpError(400, 'bad labels')

  const id = randomUUID()
  const data: ModelData = { model: b.model, dim: DIM, albums, labels, vecs: bytes.toString('base64') }
  const i: ModelInfo = {
    id,
    name,
    description: text(b.description, 500),
    category,
    seller,
    sellerEmail: email,
    price: Math.round(price * 100) / 100,
    currency: text(b.currency, 3).toUpperCase() || 'ILS',
    albums: new Set(labels).size,
    examples: labels.length,
    model: b.model,
    createdAt: new Date().toISOString(),
  }
  await writeJson(`models/${id}/data.json`, data)
  await writeJson(`models/${id}/info.json`, i)
  return json({ model: shown(i, email, true) })
}

async function withdraw(req: Request, id: string) {
  const email = await account(req)
  const i = await info(id)
  if (i.sellerEmail !== email) throw new HttpError(403, 'not your model')
  // Buyers keep what they downloaded; nobody new can get it.
  await del([`models/${id}/info.json`, `models/${id}/data.json`])
  return json({ ok: true })
}

async function buy(req: Request, id: string) {
  const email = await account(req)
  const i = await info(id)
  if (await hasLicence(i, email)) return json({ ok: true })
  if (PAYMENTS_LIVE && i.price > 0) throw new HttpError(402, 'payment required')
  await writeJson(licencePath(id, email), { model: id, email, at: new Date().toISOString(), price: i.price, currency: i.currency, paid: 0, test: !PAYMENTS_LIVE })
  return json({ ok: true })
}

async function download(req: Request, id: string) {
  const email = await account(req)
  const i = await info(id)
  if (!(await hasLicence(i, email))) throw new HttpError(403, 'no licence')
  const data = await readJson<ModelData>(`models/${id}/data.json`)
  if (!data) throw new HttpError(404, 'model not found')
  const { sellerEmail: _, ...pub } = i
  return json({ info: pub, buyer: email, data })
}

async function licence(req: Request, id: string) {
  const email = await account(req)
  const i = await readJson<ModelInfo>(`models/${id}/info.json`)
  // A withdrawn model: buyers keep using what they have, if they had a licence.
  const ok = i ? await hasLicence(i, email) : !!(await readJson(licencePath(id, email)))
  return json({ ok, email })
}

async function handle(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const id = url.searchParams.get('id')
    if (req.method === 'GET' && !action) return await shop(req)
    if (req.method === 'POST' && !action) return await publish(req)
    if (req.method === 'DELETE') return await withdraw(req, validId(id))
    if (req.method === 'POST' && action === 'buy') return await buy(req, validId(id))
    if (req.method === 'GET' && action === 'data') return await download(req, validId(id))
    if (req.method === 'GET' && action === 'licence') return await licence(req, validId(id))
    return json({ error: 'not found' }, 404)
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'server error' }, 500)
  }
}

export const GET = handle
export const POST = handle
export const DELETE = handle
