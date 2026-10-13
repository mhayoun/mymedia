// MyMedia's only server: the shop of classification models.
//
// Payment: the buyer pays MyMedia's PayPal account; MyMedia keeps its
// commission (MYMEDIA_FEE %) and pays the rest to the seller's PayPal account
// by hand, from the list of sales owed (admins: MYMEDIA_ADMINS).
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
//   orders/<paypal order>.json PayPal orders started, until paid
//   sales/<seller hash>/<paypal order>.json  one per sale: price, commission, seller's share, paid out
//
//   GET    /api/models                      shop
//   POST   /api/models                      publish (body: PublishBody)
//   DELETE /api/models?id=                  withdraw (seller only)
//   POST   /api/models?action=buy&id=       get a licence: free, or a PayPal order to approve
//   POST   /api/models?action=capture&id=&order=  after PayPal: take the payment, give the licence
//   GET    /api/models?action=data&id=      the model (seller or licence)
//   GET    /api/models?action=licence&id=   is this account's licence valid
//   GET    /api/models?action=sales         the seller's sales: owed and paid out
//   GET    /api/models?action=payouts       admins: what is owed to each seller
//   POST   /api/models?action=payout        admins: these sales are paid out (body: { orders })

import { del, get, list, put } from '@vercel/blob'
import { createHash, randomUUID } from 'node:crypto'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '246067015646-63ga5nqjgihi3sd8mmb3ch0urb0i1q5m.apps.googleusercontent.com'
// Without PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, every model is free (test).
const PAYPAL_ID = process.env.PAYPAL_CLIENT_ID ?? ''
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? ''
const PAYPAL_API = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
const paymentsLive = () => !!(PAYPAL_ID && PAYPAL_SECRET)
/** MyMedia's commission, in % of the price. */
const FEE = Math.min(Math.max(Number(process.env.MYMEDIA_FEE ?? 15) || 0, 0), 100)
const ADMINS = (process.env.MYMEDIA_ADMINS ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean)
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
  /** The PayPal account the seller's share is sent to. */
  sellerPaypal?: string
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
  paypal?: string
  price: number
  currency?: string
}

interface Order {
  model: string
  email: string
  amount: string
  currency: string
}

interface Sale {
  order: string
  model: string
  modelName: string
  seller: string
  sellerEmail: string
  sellerPaypal: string
  at: string
  price: number
  currency: string
  /** MyMedia's commission. */
  fee: number
  /** What the seller is owed. */
  share: number
  /** When MyMedia sent the share to the seller. */
  paidOut: string | null
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

const hashOf = (email: string) => createHash('sha256').update(email).digest('hex').slice(0, 32)
const licencePath = (id: string, email: string) => `licences/${id}/${hashOf(email)}.json`
const cents = (n: number) => Math.round(n * 100) / 100
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
  const { sellerEmail, sellerPaypal: _, ...rest } = i
  return { ...rest, mine: sellerEmail === email, owned, paymentsLive: paymentsLive() }
}

function giveLicence(i: ModelInfo, email: string, paid: number, order?: string) {
  return writeJson(licencePath(i.id, email), { model: i.id, email, at: new Date().toISOString(), price: i.price, currency: i.currency, paid, order, test: !paymentsLive() })
}

// ---- PayPal ------------------------------------------------------------------

let paypalToken: { token: string; until: number } | null = null

async function paypal<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  if (!paypalToken || paypalToken.until < Date.now()) {
    const r = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${PAYPAL_ID}:${PAYPAL_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!r.ok) throw new Error(`PayPal sign-in ${r.status}`)
    const t = (await r.json()) as { access_token: string; expires_in: number }
    paypalToken = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 }
  }
  const r = await fetch(`${PAYPAL_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${paypalToken.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T }
}

interface PaypalOrder {
  id?: string
  status?: string
  links?: { rel: string; href: string }[]
  purchase_units?: {
    reference_id?: string
    payments?: { captures?: { status?: string; amount?: { value?: string; currency_code?: string } }[] }
  }[]
}

const amountOf = (price: number) => price.toFixed(2)

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
  return json({ models: out, paymentsLive: paymentsLive(), fee: FEE, admin: !!email && ADMINS.includes(email) })
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
  const sellerPaypal = text(b.paypal, 120).toLowerCase()
  if (sellerPaypal && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sellerPaypal)) throw new HttpError(400, 'bad paypal')
  if (price > 0 && !sellerPaypal) throw new HttpError(400, 'paypal required')
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
    sellerPaypal: sellerPaypal || undefined,
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
  if (!paymentsLive() || i.price <= 0) {
    await giveLicence(i, email, 0)
    return json({ ok: true })
  }
  if (!i.sellerPaypal) throw new HttpError(409, 'seller has no paypal')
  // Paid to MyMedia (the PayPal app's account). The buyer approves on PayPal's page, which sends them back to MyMedia.
  const back = `${new URL(req.url).origin}/?paypal=1&model=${id}`
  const amount = amountOf(i.price)
  const r = await paypal<PaypalOrder>('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: id,
        description: `MyMedia: ${i.name}`.slice(0, 127),
        amount: { currency_code: i.currency, value: amount },
      },
    ],
    payment_source: {
      paypal: {
        experience_context: { brand_name: 'MyMedia', user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: back, cancel_url: `${back}&cancel=1` },
      },
    },
  })
  const approve = r.body.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href
  if (r.status >= 300 || !r.body.id || !approve) {
    console.error('[paypal] order', r.status, JSON.stringify(r.body))
    throw new HttpError(502, 'paypal refused the order')
  }
  const order: Order = { model: id, email, amount, currency: i.currency }
  await writeJson(`orders/${r.body.id}.json`, order)
  return json({ ok: false, approve, order: r.body.id })
}

async function capture(req: Request, id: string, orderId: string | null) {
  const email = await account(req)
  if (!orderId || !/^[A-Z0-9]{5,40}$/.test(orderId)) throw new HttpError(400, 'bad order')
  const i = await info(id)
  if (await hasLicence(i, email)) return json({ ok: true })
  const order = await readJson<Order>(`orders/${orderId}.json`)
  if (!order || order.model !== id || order.email !== email) throw new HttpError(404, 'order not found')
  let r = await paypal<PaypalOrder & { details?: { issue?: string }[] }>('POST', `/v2/checkout/orders/${orderId}/capture`)
  // Captured already (the page was reloaded): read the order.
  if (r.status === 422 && r.body.details?.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED')) r = await paypal<PaypalOrder>('GET', `/v2/checkout/orders/${orderId}`)
  const unit = r.body.purchase_units?.[0]
  const paid = unit?.payments?.captures?.find((c) => c.status === 'COMPLETED')
  if (r.status >= 300 || r.body.status !== 'COMPLETED' || unit?.reference_id !== id || !paid) {
    console.error('[paypal] capture', r.status, JSON.stringify(r.body))
    throw new HttpError(402, 'not paid')
  }
  if (paid.amount?.value !== order.amount || paid.amount?.currency_code !== order.currency) throw new HttpError(402, 'wrong amount')
  const price = Number(order.amount)
  const fee = cents((price * FEE) / 100)
  const sale: Sale = {
    order: orderId,
    model: id,
    modelName: i.name,
    seller: i.seller,
    sellerEmail: i.sellerEmail,
    sellerPaypal: i.sellerPaypal ?? '',
    at: new Date().toISOString(),
    price,
    currency: order.currency,
    fee,
    share: cents(price - fee),
    paidOut: null,
  }
  await writeJson(`sales/${hashOf(i.sellerEmail)}/${orderId}.json`, sale)
  await giveLicence(i, email, price, orderId)
  await del([`orders/${orderId}.json`])
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

async function salesUnder(prefix: string): Promise<{ pathname: string; sale: Sale }[]> {
  const out: { pathname: string; sale: Sale }[] = []
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor })
    for (const b of page.blobs) {
      const sale = await readJson<Sale>(b.pathname)
      if (sale) out.push({ pathname: b.pathname, sale })
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}

/** Sums by currency. */
function totals(sales: Sale[], pick: (s: Sale) => number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of sales) out[s.currency] = cents((out[s.currency] ?? 0) + pick(s))
  return out
}

async function sales(req: Request) {
  const email = await account(req)
  const all = (await salesUnder(`sales/${hashOf(email)}/`)).map((x) => x.sale)
  return json({
    count: all.length,
    owed: totals(all.filter((s) => !s.paidOut), (s) => s.share),
    paidOut: totals(all.filter((s) => s.paidOut), (s) => s.share),
    fee: FEE,
  })
}

async function admin(req: Request): Promise<string> {
  const email = await account(req)
  if (!ADMINS.includes(email)) throw new HttpError(403, 'admins only')
  return email
}

async function payouts(req: Request) {
  await admin(req)
  const owed = new Map<string, { seller: string; sellerEmail: string; paypal: string; currency: string; amount: number; fees: number; orders: string[]; oldest: string }>()
  for (const { sale: s } of await salesUnder('sales/')) {
    if (s.paidOut) continue
    const key = `${s.sellerEmail}\n${s.currency}`
    const row = owed.get(key) ?? { seller: s.seller, sellerEmail: s.sellerEmail, paypal: s.sellerPaypal, currency: s.currency, amount: 0, fees: 0, orders: [], oldest: s.at }
    row.amount = cents(row.amount + s.share)
    row.fees = cents(row.fees + s.fee)
    row.orders.push(s.order)
    if (s.at < row.oldest) row.oldest = s.at
    owed.set(key, row)
  }
  return json({ payouts: [...owed.values()].sort((a, b) => b.amount - a.amount) })
}

async function payout(req: Request) {
  await admin(req)
  const b = (await req.json().catch(() => ({}))) as { orders?: unknown }
  const orders = new Set(Array.isArray(b.orders) ? b.orders.filter((o): o is string => typeof o === 'string') : [])
  if (!orders.size) throw new HttpError(400, 'no orders')
  const at = new Date().toISOString()
  let marked = 0
  for (const { pathname, sale } of await salesUnder('sales/')) {
    if (sale.paidOut || !orders.has(sale.order)) continue
    await writeJson(pathname, { ...sale, paidOut: at })
    marked++
  }
  return json({ ok: true, marked })
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
    if (req.method === 'POST' && action === 'capture') return await capture(req, validId(id), url.searchParams.get('order'))
    if (req.method === 'GET' && action === 'data') return await download(req, validId(id))
    if (req.method === 'GET' && action === 'licence') return await licence(req, validId(id))
    if (req.method === 'GET' && action === 'sales') return await sales(req)
    if (req.method === 'GET' && action === 'payouts') return await payouts(req)
    if (req.method === 'POST' && action === 'payout') return await payout(req)
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
