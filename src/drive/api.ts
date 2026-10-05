// Minimal Google Drive v3 REST client used by the app.

import { auth } from '../auth/google'
import { FOLDER_MIME } from '../lib/media'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export const FILE_FIELDS =
  'id,name,mimeType,parents,size,md5Checksum,createdTime,modifiedTime,thumbnailLink,trashed,webViewLink,' +
  'imageMediaMetadata(width,height,time,cameraMake,cameraModel,rotation),videoMediaMetadata(width,height,durationMillis),appProperties'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  size?: string
  md5Checksum?: string
  createdTime?: string
  modifiedTime?: string
  thumbnailLink?: string
  trashed?: boolean
  webViewLink?: string
  imageMediaMetadata?: {
    width?: number
    height?: number
    time?: string
    cameraMake?: string
    cameraModel?: string
    rotation?: number
  }
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string }
  appProperties?: Record<string, string>
}

export interface DriveChangeRaw {
  fileId: string
  removed?: boolean
  file?: DriveFile
}

export class DriveError extends Error {
  status: number
  reason?: string
  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function waitOnline(): Promise<void> {
  if (navigator.onLine) return Promise.resolve()
  return new Promise((resolve) => window.addEventListener('online', () => resolve(), { once: true }))
}

async function request(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  let delay = 1000
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    await waitOnline()
    const token = await auth.getToken()
    signal?.throwIfAborted()
    let res: Response
    try {
      res = await fetch(url, {
        ...init,
        signal,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      })
    } catch (e) {
      if (signal?.aborted) throw e
      if (attempt >= 5) throw e
      await sleep(delay)
      delay *= 2
      continue
    }
    if (res.ok) return res
    if (res.status === 401) {
      // Token rejected: the next getToken() waits for a renewal.
      auth.invalidate()
      continue
    }
    let reason: string | undefined
    let message = `Drive error ${res.status}`
    try {
      const body = await res.json()
      reason = body?.error?.errors?.[0]?.reason
      message = body?.error?.message ?? message
    } catch {
      // body was not JSON
    }
    const retryable =
      res.status === 429 || res.status >= 500 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
    if (retryable && attempt < 6) {
      await sleep(delay + Math.random() * 500)
      delay *= 2
      continue
    }
    throw new DriveError(res.status, message, reason)
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return (await request(url, {}, signal)).json() as Promise<T>
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export async function about(): Promise<{ email: string; name: string; photo?: string }> {
  const r = await getJson<{ user: { emailAddress: string; displayName: string; photoLink?: string } }>(
    `${API}/about?fields=user(emailAddress,displayName,photoLink)`,
  )
  return { email: r.user.emailAddress, name: r.user.displayName, photo: r.user.photoLink }
}

/** Lists all files matching a query, page by page. */
export async function listFiles(
  query: string,
  onPage: (files: DriveFile[]) => void | Promise<void>,
  signal?: AbortSignal,
  fields = FILE_FIELDS,
): Promise<void> {
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q: query,
      fields: `nextPageToken,files(${fields})`,
      pageSize: '1000',
      spaces: 'drive',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const r = await getJson<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${params}`, signal)
    await onPage(r.files ?? [])
    pageToken = r.nextPageToken
  } while (pageToken)
}

export function childrenQuery(parentIds: string[]): string {
  return `(${parentIds.map((id) => `'${q(id)}' in parents`).join(' or ')}) and trashed = false`
}

export async function getFile(id: string, fields = FILE_FIELDS): Promise<DriveFile> {
  return getJson<DriveFile>(`${API}/files/${id}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`)
}

export async function findFolderInMyDrive(name: string): Promise<DriveFile | null> {
  let found: DriveFile | null = null
  await listFiles(
    `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
    (files) => {
      found ??= files[0] ?? null
    },
    undefined,
    'id,name,mimeType,parents,createdTime',
  )
  return found
}

export async function findChildByName(parentId: string, name: string): Promise<DriveFile | null> {
  let found: DriveFile | null = null
  await listFiles(
    `name = '${q(name)}' and '${q(parentId)}' in parents and trashed = false`,
    (files) => {
      found ??= files[0] ?? null
    },
    undefined,
    'id,name,mimeType,parents,modifiedTime,version',
  )
  return found
}

export async function createFolder(name: string, parentId: string): Promise<DriveFile> {
  const res = await request(`${API}/files?fields=id,name,mimeType,parents&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  return res.json()
}

export async function renameFile(id: string, name: string): Promise<DriveFile> {
  const res = await request(`${API}/files/${id}?fields=id,name,mimeType,parents&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return res.json()
}

/** Moves to Drive's trash (recoverable for 30 days), never a permanent delete. */
export async function trashFile(id: string): Promise<void> {
  await request(`${API}/files/${id}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

export async function getStartPageToken(): Promise<string> {
  const r = await getJson<{ startPageToken: string }>(`${API}/changes/startPageToken?supportsAllDrives=true`)
  return r.startPageToken
}

/** Reads all changes since pageToken; returns them with the token to use next time. */
export async function listChanges(
  pageToken: string,
  signal?: AbortSignal,
): Promise<{ changes: DriveChangeRaw[]; newStartPageToken: string }> {
  const changes: DriveChangeRaw[] = []
  let token = pageToken
  for (;;) {
    const params = new URLSearchParams({
      pageToken: token,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      pageSize: '1000',
      includeRemoved: 'true',
      spaces: 'drive',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    })
    const r = await getJson<{ changes: DriveChangeRaw[]; nextPageToken?: string; newStartPageToken?: string }>(
      `${API}/changes?${params}`,
      signal,
    )
    changes.push(...(r.changes ?? []))
    if (r.newStartPageToken) return { changes, newStartPageToken: r.newStartPageToken }
    if (!r.nextPageToken) throw new Error('Drive changes: missing page token')
    token = r.nextPageToken
  }
}

export async function downloadText(id: string): Promise<string> {
  return (await request(`${API}/files/${id}?alt=media&supportsAllDrives=true`)).text()
}

/** Downloads a file's content, reporting progress (0..1) when the size is known. */
export async function downloadBlob(id: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await request(`${API}/files/${id}?alt=media&supportsAllDrives=true`, {}, signal)
  const total = Number(res.headers.get('Content-Length')) || 0
  if (!res.body || !onProgress || !total) return res.blob()
  const reader = res.body.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(received / total)
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') ?? undefined })
}

function multipartBody(metadata: object, content: string, contentType: string): { body: string; boundary: string } {
  const boundary = `mymedia-${Math.random().toString(36).slice(2)}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n${content}\r\n--${boundary}--`
  return { body, boundary }
}

export async function createTextFile(name: string, parentId: string, content: string, mime = 'application/json'): Promise<DriveFile> {
  const { body, boundary } = multipartBody({ name, parents: [parentId], mimeType: mime }, content, `${mime}; charset=UTF-8`)
  const res = await request(`${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime,version&supportsAllDrives=true`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return res.json()
}

export async function updateTextFile(id: string, content: string, mime = 'application/json'): Promise<DriveFile> {
  const { body, boundary } = multipartBody({}, content, `${mime}; charset=UTF-8`)
  const res = await request(`${UPLOAD}/files/${id}?uploadType=multipart&fields=id,name,modifiedTime,version&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return res.json()
}
