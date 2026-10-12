import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory Vercel Blob store.
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

const CLIENT = '246067015646-63ga5nqjgihi3sd8mmb3ch0urb0i1q5m.apps.googleusercontent.com'
// Google: token "seller", "buyer", "friend" → that account; "otherapp" belongs to another app.
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    const token = new URL(url).searchParams.get('access_token')
    return Response.json({ aud: token === 'otherapp' ? 'someone-else' : CLIENT, expires_in: '3000' })
  }
  const token = String((init?.headers as Record<string, string>).Authorization).split(' ')[1]
  return Response.json({ user: { emailAddress: `${token}@gmail.com` } })
})

const { GET, POST, DELETE } = await import('../api/models')

const req = (method: string, query: string, token?: string, body?: unknown) =>
  new Request(`https://x/api/models${query}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: body ? JSON.stringify(body) : undefined,
  })

const publishBody = {
  name: 'Oiseaux',
  category: 'ציפורים',
  seller: 'Katia',
  price: 25,
  currency: 'ILS',
  model: 'm',
  dim: 768,
  albums: ['חנקן אדום ראש', 'חסידה לבנה'],
  labels: [0, 1, 1],
  vecs: Buffer.alloc(3 * 768, 7).toString('base64'),
}

describe('model shop', () => {
  beforeEach(() => store.clear())

  it('publishes, gives a licence to the buyer only, and lets the seller withdraw', async () => {
    const pub = await (await POST(req('POST', '', 'seller', publishBody))).json()
    const id = pub.model.id as string
    expect(pub.model).toMatchObject({ albums: 2, examples: 3, price: 25, mine: true })
    expect(pub.model.sellerEmail).toBeUndefined()

    const shop = await (await GET(req('GET', '', 'buyer'))).json()
    expect(shop.models).toHaveLength(1)
    expect(shop.models[0]).toMatchObject({ owned: false, mine: false, paymentsLive: false })

    expect((await GET(req('GET', `?action=data&id=${id}`, 'buyer'))).status).toBe(403)
    expect((await POST(req('POST', `?action=buy&id=${id}`, 'buyer'))).status).toBe(200)
    const data = await (await GET(req('GET', `?action=data&id=${id}`, 'buyer'))).json()
    expect(data.buyer).toBe('buyer@gmail.com')
    expect(data.data.albums).toEqual(publishBody.albums)

    expect(await (await GET(req('GET', `?action=licence&id=${id}`, 'buyer'))).json()).toMatchObject({ ok: true })
    // The buyer gave the file to a friend: the friend has no licence.
    expect(await (await GET(req('GET', `?action=licence&id=${id}`, 'friend'))).json()).toMatchObject({ ok: false })
    expect((await GET(req('GET', `?action=data&id=${id}`, 'friend'))).status).toBe(403)

    expect((await DELETE(req('DELETE', `?id=${id}`, 'buyer'))).status).toBe(403)
    expect((await DELETE(req('DELETE', `?id=${id}`, 'seller'))).status).toBe(200)
    expect((await (await GET(req('GET', ''))).json()).models).toHaveLength(0)
    // Withdrawn: the buyer keeps their licence.
    expect(await (await GET(req('GET', `?action=licence&id=${id}`, 'buyer'))).json()).toMatchObject({ ok: true })
  })

  it('refuses missing or foreign tokens and bad data', async () => {
    expect((await POST(req('POST', '', undefined, publishBody))).status).toBe(401)
    expect((await POST(req('POST', '', 'otherapp', publishBody))).status).toBe(401)
    expect((await POST(req('POST', '', 'seller', { ...publishBody, labels: [0, 5, 1] }))).status).toBe(400)
    expect((await POST(req('POST', '', 'seller', { ...publishBody, vecs: 'AAAA' }))).status).toBe(400)
    expect((await GET(req('GET', '?action=data&id=../x', 'buyer'))).status).toBe(400)
  })
})
