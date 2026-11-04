import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/auth/google', () => ({ auth: { getToken: async () => 'token', invalidate: vi.fn() } }))
vi.stubGlobal('navigator', { onLine: true })

const api = await import('../src/drive/api')

afterEach(() => vi.unstubAllGlobals())

function fakeFetch(answer: unknown) {
  const calls: { url: string; body?: string }[] = []
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body as string | undefined })
    return new Response(JSON.stringify(answer), { status: 200 })
  })
  return calls
}

describe('notes written as private and public properties', () => {
  it('sends every private note as a public one too, removals included', () => {
    expect(api.withPublicProps({ name: 'a', appProperties: { mymedia_taken: '2020-01-01T00:00:00', x: null } })).toEqual({
      name: 'a',
      appProperties: { mymedia_taken: '2020-01-01T00:00:00', x: null },
      properties: { mymedia_taken: '2020-01-01T00:00:00', x: null },
    })
    expect(api.withPublicProps({ name: 'a' })).toEqual({ name: 'a' })
  })

  it('asks Drive for the public copies wherever it asks for the private notes', () => {
    expect(api.FILE_FIELDS).toMatch(/appProperties,properties$/)
    expect(api.withPublicFields('id,appProperties')).toBe('id,appProperties,properties')
    expect(api.withPublicFields('appProperties')).toBe('appProperties,properties')
    expect(api.withPublicFields('id,appProperties,properties')).toBe('id,appProperties,properties')
    expect(api.withPublicFields('id,name')).toBe('id,name')
  })

  it('merges both, the private value first, and tells when a public copy is missing', () => {
    const old = api.mergeProps({ id: '1', name: 'a', mimeType: 'image/jpeg', appProperties: { mymedia_taken: 'T1' } })
    expect(old.appProperties).toEqual({ mymedia_taken: 'T1' })
    expect(old.privateOnly).toBe(true)

    const both = api.mergeProps({ id: '2', name: 'a', mimeType: 'image/jpeg', appProperties: { mymedia_taken: 'T1' }, properties: { mymedia_taken: 'T1' } })
    expect(both.privateOnly).toBeUndefined()

    const stale = api.mergeProps({ id: '3', name: 'a', mimeType: 'image/jpeg', appProperties: { mymedia_taken: 'T2' }, properties: { mymedia_taken: 'T1', mymedia_compressed: '1' } })
    expect(stale.appProperties).toEqual({ mymedia_taken: 'T2', mymedia_compressed: '1' })
    expect(stale.privateOnly).toBe(true)

    // Another project of MyMedia: the private notes are not visible, the public copies are.
    const other = api.mergeProps({ id: '4', name: 'a', mimeType: 'image/jpeg', properties: { mymedia_date_set: 'T3' } })
    expect(other.appProperties).toEqual({ mymedia_date_set: 'T3' })
    expect(other.privateOnly).toBeUndefined()
  })

  it('writes the public copy with each change of a note', async () => {
    const calls = fakeFetch({ id: 'f' })
    await api.setAppProperties('f', { mymedia_date_set: 'T', mymedia_compressed: null })
    expect(JSON.parse(calls[0].body!)).toEqual({
      appProperties: { mymedia_date_set: 'T', mymedia_compressed: null },
      properties: { mymedia_date_set: 'T', mymedia_compressed: null },
    })
  })

  it('reads a file with its public copies merged', async () => {
    const calls = fakeFetch({ id: 'f', name: 'a', mimeType: 'image/jpeg', properties: { mymedia_taken: 'T' } })
    const f = await api.getFile('f', 'id,appProperties')
    expect(decodeURIComponent(calls[0].url)).toContain('fields=id,appProperties,properties')
    expect(f.appProperties).toEqual({ mymedia_taken: 'T' })
  })
})

describe('copy of the older notes', () => {
  it('copies the notes of a file that has only private ones', async () => {
    vi.doMock('../src/db/db', () => ({ db: vi.fn() }))
    vi.doMock('../src/store', () => ({ app: vi.fn() }))
    const { publicCopyOf } = await import('../src/sync/publicProps')
    expect(publicCopyOf({ id: 'a', appProperties: { mymedia_taken: 'T' }, privateOnly: true })).toEqual({ id: 'a', props: { mymedia_taken: 'T' } })
    expect(publicCopyOf({ id: 'b', appProperties: { mymedia_taken: 'T' } })).toBeNull()
    expect(publicCopyOf({ id: 'c', appProperties: {}, privateOnly: true })).toBeNull()
  })
})
