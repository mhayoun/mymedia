import { beforeEach, describe, expect, it, vi } from 'vitest'

// The shop with PayPal plugged in (sandbox), PayPal and Google faked.
const store = new Map<string, string>()
vi.mock('@vercel/blob', () => ({
  put: async (pathname: string, body: string) => void store.set(pathname, body),
  get: async (pathname: string) =>
    store.has(pathname) ? { statusCode: 200, stream: new Response(store.get(pathname)).body } : null,
  del: async (paths: string[]) => paths.forEach((p) => store.delete(p)),
  list: async ({ prefix }: { prefix: string }) => ({
    blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })),
    hasMore: false,
  }),
}))

process.env.PAYPAL_CLIENT_ID = 'pp-id'
process.env.PAYPAL_CLIENT_SECRET = 'pp-secret'
process.env.MYMEDIA_FEE = '15'
process.env.MYMEDIA_ADMINS = 'admin@gmail.com'

const CLIENT = '246067015646-63ga5nqjgihi3sd8mmb3ch0urb0i1q5m.apps.googleusercontent.com'
/** PayPal orders: id → what was asked, and whether the buyer approved it. */
const orders = new Map<string, { body: { purchase_units: { reference_id: string; amount: { value: string; currency_code: string }; payee?: unknown }[] }; approved: boolean; captured: boolean }>()
let paidValue: string | null = null

vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) return Response.json({ aud: CLIENT, expires_in: '3000' })
  if (url.startsWith('https://www.googleapis.com/drive')) {
    const token = String((init?.headers as Record<string, string>).Authorization).split(' ')[1]
    return Response.json({ user: { emailAddress: `${token}@gmail.com` } })
  }
  const path = url.replace('https://api-m.sandbox.paypal.com', '')
  if (path === '/v1/oauth2/token') return Response.json({ access_token: 'pp', expires_in: 3600 })
  if (path === '/v2/checkout/orders') {
    const id = `ORDER${orders.size + 1}`
    orders.set(id, { body: JSON.parse(String(init!.body)), approved: false, captured: false })
    return Response.json({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://paypal.test/pay?token=${id}` }] }, { status: 200 })
  }
  const m = /^\/v2\/checkout\/orders\/(\w+)\/capture$/.exec(path)
  const o = m && orders.get(m[1])
  if (!o) return Response.json({}, { status: 404 })
  if (!o.approved) return Response.json({ details: [{ issue: 'ORDER_NOT_APPROVED' }] }, { status: 422 })
  o.captured = true
  const unit = o.body.purchase_units[0]
  return Response.json(
    {
      status: 'COMPLETED',
      purchase_units: [
        { reference_id: unit.reference_id, payments: { captures: [{ status: 'COMPLETED', amount: { ...unit.amount, value: paidValue ?? unit.amount.value } }] } },
      ],
    },
    { status: 201 },
  )
})

const { GET, POST } = await import('../api/models')

const req = (method: string, query: string, token?: string, body?: unknown) =>
  new Request(`https://media.test/api/models${query}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: body ? JSON.stringify(body) : undefined,
  })

const publishBody = {
  name: 'Oiseaux',
  category: 'ציפורים',
  seller: 'Katia',
  paypal: 'Katia.Pay@example.com',
  price: 25,
  currency: 'ILS',
  model: 'm',
  dim: 768,
  albums: ['a', 'b'],
  labels: [0, 1],
  vecs: Buffer.alloc(2 * 768, 7).toString('base64'),
}

describe('model shop with PayPal', () => {
  beforeEach(() => {
    store.clear()
    orders.clear()
    paidValue = null
  })

  it('needs a PayPal account to publish a paid model, and keeps it private', async () => {
    expect((await POST(req('POST', '', 'seller', { ...publishBody, paypal: '' }))).status).toBe(400)
    expect((await POST(req('POST', '', 'seller', { ...publishBody, paypal: '', price: 0 }))).status).toBe(200)
    const pub = await (await POST(req('POST', '', 'seller', publishBody))).json()
    expect(pub.model.sellerPaypal).toBeUndefined()
    const shop = await (await GET(req('GET', '', 'buyer'))).json()
    expect(shop.paymentsLive).toBe(true)
  })

  it('gives the licence only once the buyer paid MyMedia the price', async () => {
    const id = (await (await POST(req('POST', '', 'seller', publishBody))).json()).model.id as string
    const buy = await (await POST(req('POST', `?action=buy&id=${id}`, 'buyer'))).json()
    expect(buy).toMatchObject({ ok: false, approve: 'https://paypal.test/pay?token=ORDER1', order: 'ORDER1' })
    const asked = orders.get('ORDER1')!.body.purchase_units[0]
    expect(asked).toMatchObject({ reference_id: id, amount: { value: '25.00', currency_code: 'ILS' } })
    // Paid to MyMedia, which pays the seller their share.
    expect(asked.payee).toBeUndefined()

    // Not approved on PayPal yet, or someone else's order: no licence.
    expect((await POST(req('POST', `?action=capture&id=${id}&order=ORDER1`, 'buyer'))).status).toBe(402)
    orders.get('ORDER1')!.approved = true
    expect((await POST(req('POST', `?action=capture&id=${id}&order=ORDER1`, 'friend'))).status).toBe(404)
    expect((await GET(req('GET', `?action=data&id=${id}`, 'buyer'))).status).toBe(403)

    expect((await POST(req('POST', `?action=capture&id=${id}&order=ORDER1`, 'buyer'))).status).toBe(200)
    expect(await (await GET(req('GET', `?action=licence&id=${id}`, 'buyer'))).json()).toMatchObject({ ok: true })
    expect((await GET(req('GET', `?action=data&id=${id}`, 'buyer'))).status).toBe(200)
    // Bought: getting it again asks nothing more.
    expect(await (await POST(req('POST', `?action=buy&id=${id}`, 'buyer'))).json()).toEqual({ ok: true })
  })

  it('owes the seller the price less the commission, until an admin pays it out', async () => {
    const id = (await (await POST(req('POST', '', 'seller', publishBody))).json()).model.id as string
    for (const buyer of ['buyer', 'buyer2']) {
      const { order } = await (await POST(req('POST', `?action=buy&id=${id}`, buyer))).json()
      orders.get(order)!.approved = true
      expect((await POST(req('POST', `?action=capture&id=${id}&order=${order}`, buyer))).status).toBe(200)
    }
    const mine = await (await GET(req('GET', '?action=sales', 'seller'))).json()
    expect(mine).toMatchObject({ count: 2, owed: { ILS: 42.5 }, paidOut: {}, fee: 15 })
    expect(mine.list).toHaveLength(2)
    expect(mine.list[0]).toEqual({ order: expect.any(String), at: expect.any(String), model: expect.any(String), price: 25, currency: 'ILS', fee: 3.75, share: 21.25, paidOut: null, test: expect.any(Boolean) })
    expect(JSON.stringify(mine)).not.toContain('buyer')
    expect(await (await GET(req('GET', '?action=sales', 'buyer'))).json()).toMatchObject({ count: 0 })

    expect((await GET(req('GET', '?action=payouts', 'seller'))).status).toBe(403)
    const { payouts } = await (await GET(req('GET', '?action=payouts', 'admin'))).json()
    expect(payouts).toEqual([
      { seller: 'Katia', sellerEmail: 'seller@gmail.com', paypal: 'katia.pay@example.com', currency: 'ILS', amount: 42.5, fees: 7.5, orders: ['ORDER1', 'ORDER2'], oldest: expect.any(String) },
    ])
    expect((await POST(req('POST', '?action=payout', 'seller', { orders: ['ORDER1'] }))).status).toBe(403)
    expect(await (await POST(req('POST', '?action=payout', 'admin', { orders: ['ORDER1'] }))).json()).toEqual({ ok: true, marked: 1 })
    expect(await (await GET(req('GET', '?action=sales', 'seller'))).json()).toMatchObject({ owed: { ILS: 21.25 }, paidOut: { ILS: 21.25 } })
    expect((await (await GET(req('GET', '?action=payouts', 'admin'))).json()).payouts[0]).toMatchObject({ amount: 21.25, orders: ['ORDER2'] })
    expect((await (await GET(req('GET', '', 'admin'))).json())).toMatchObject({ admin: true, fee: 15 })
  })

  it('refuses a payment of another amount', async () => {
    const id = (await (await POST(req('POST', '', 'seller', publishBody))).json()).model.id as string
    await POST(req('POST', `?action=buy&id=${id}`, 'buyer'))
    orders.get('ORDER1')!.approved = true
    paidValue = '1.00'
    expect((await POST(req('POST', `?action=capture&id=${id}&order=ORDER1`, 'buyer'))).status).toBe(402)
    expect(await (await GET(req('GET', `?action=licence&id=${id}`, 'buyer'))).json()).toMatchObject({ ok: false })
  })

  it('gives free models without PayPal', async () => {
    const id = (await (await POST(req('POST', '', 'seller', { ...publishBody, price: 0 }))).json()).model.id as string
    expect(await (await POST(req('POST', `?action=buy&id=${id}`, 'buyer'))).json()).toEqual({ ok: true })
    expect(orders.size).toBe(0)
  })

  it('gives Pro for a year once paid, a year more when bought again, and for life', async () => {
    expect(await (await GET(req('GET', '?action=pro', 'buyer'))).json()).toMatchObject({
      pro: false,
      plans: [{ id: 'year', price: 36, currency: 'ILS' }, { id: 'life', price: 50, currency: 'ILS' }],
      test: true,
    })
    expect((await POST(req('POST', '?action=buyPro&plan=month', 'buyer'))).status).toBe(400)
    const buy = await (await POST(req('POST', '?action=buyPro&plan=year', 'buyer'))).json()
    expect(buy).toMatchObject({ ok: false, order: 'ORDER1' })
    expect(orders.get('ORDER1')!.body.purchase_units[0]).toMatchObject({ reference_id: 'pro-year', amount: { value: '36.00', currency_code: 'ILS' } })

    // Not approved yet, someone else's order, or a Pro order used for a model: nothing.
    expect((await POST(req('POST', '?action=capturePro&order=ORDER1', 'buyer'))).status).toBe(402)
    orders.get('ORDER1')!.approved = true
    expect((await POST(req('POST', '?action=capturePro&order=ORDER1', 'friend'))).status).toBe(404)
    const id = (await (await POST(req('POST', '', 'seller', publishBody))).json()).model.id as string
    expect((await POST(req('POST', `?action=capture&id=${id}&order=ORDER1`, 'buyer'))).status).toBe(404)

    const got = await (await POST(req('POST', '?action=capturePro&order=ORDER1', 'buyer'))).json()
    expect(got).toMatchObject({ ok: true, pro: true, life: false })
    const days = (iso: string) => (Date.parse(iso) - Date.now()) / 86400_000
    expect(days(got.until)).toBeCloseTo(365, 0)
    // The page reloaded after PayPal: no second year.
    expect((await (await POST(req('POST', '?action=capturePro&order=ORDER1', 'buyer'))).json()).until).toBe(got.until)

    const again = await (await POST(req('POST', '?action=buyPro&plan=year', 'buyer'))).json()
    orders.get(again.order)!.approved = true
    expect(days((await (await POST(req('POST', `?action=capturePro&order=${again.order}`, 'buyer'))).json()).until)).toBeCloseTo(730, 0)

    const life = await (await POST(req('POST', '?action=buyPro&plan=life', 'buyer'))).json()
    orders.get(life.order)!.approved = true
    paidValue = '36.00'
    expect((await POST(req('POST', `?action=capturePro&order=${life.order}`, 'buyer'))).status).toBe(402)
    paidValue = null
    expect(await (await POST(req('POST', `?action=capturePro&order=${life.order}`, 'buyer'))).json()).toMatchObject({ pro: true, life: true })
    expect(await (await POST(req('POST', '?action=buyPro&plan=year', 'buyer'))).json()).toMatchObject({ ok: true, life: true })
    expect(await (await GET(req('GET', '?action=pro', 'friend'))).json()).toMatchObject({ pro: false })
  })

  it('does not sell Pro inside the Android app', async () => {
    const r = new Request('https://media.test/api/models?action=buyPro&plan=year', { method: 'POST', headers: { Authorization: 'Bearer buyer', origin: 'https://localhost' } })
    expect((await POST(r)).status).toBe(403)
  })
})
