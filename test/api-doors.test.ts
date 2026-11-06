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

const FULL = '246067015646-63ga5nqjgihi3sd8mmb3ch0urb0i1q5m.apps.googleusercontent.com'
const FREE = '94880969749-8nu1dudc5hufa138k1hhviakr2fv0emb.apps.googleusercontent.com'
// Token "<name>.free" → <name>@gmail.com through MyMedia Free; "<name>.full" → through the full door.
vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
    const token = new URLSearchParams(String(init?.body)).get('access_token')!
    const full = token.endsWith('.full')
    return Response.json({
      aud: full ? FULL : FREE,
      scope: full ? 'https://www.googleapis.com/auth/drive' : 'https://www.googleapis.com/auth/drive.file',
      expires_in: '3000',
    })
  }
  const token = String((init?.headers as Record<string, string>).Authorization).split(' ')[1]
  return Response.json({ user: { emailAddress: `${token.split('.')[0]}@gmail.com` } })
})

const { GET } = await import('../api/models')

const pro = async (token: string) =>
  (await (await GET(new Request('https://x/api/models?action=pro', { headers: { Authorization: `Bearer ${token}` } }))).json()) as {
    full: boolean
    pro: boolean
  }

describe('the two doors', () => {
  beforeEach(() => store.clear())

  it('takes the tokens of MyMedia Free: a new account stays on the free door', async () => {
    expect(await pro('newcomer.free')).toMatchObject({ full: false, pro: false })
    expect([...store.keys()]).toEqual([])
  })

  it('keeps the accounts that used the full access before the free door on the full door', async () => {
    expect((await pro('yelotag.free')).full).toBe(true)
    expect((await pro('katiabirds.free')).full).toBe(true)
  })

  it('writes down the first full access of an account, and keeps it on the full door for good', async () => {
    expect((await pro('buyer.free')).full).toBe(false)
    expect((await pro('buyer.full')).full).toBe(true)
    expect([...store.keys()].filter((k) => k.startsWith('full/'))).toHaveLength(1)
    // Back with a free token (another device): still the full door.
    expect((await pro('buyer.free')).full).toBe(true)
  })
})
