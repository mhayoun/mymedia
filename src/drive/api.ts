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

export interface DriveQuota {
  /** Bytes used by the whole account (Drive + Gmail + Photos). */
  usage: number
  /** Total space; undefined for unlimited accounts. */
  limit?: number
}

export async function storageQuota(): Promise<DriveQuota> {
  const r = await getJson<{ storageQuota: { usage: string; limit?: string } }>(`${API}/about?fields=storageQuota(usage,limit)`)
  const q = r.storageQuota
  return { usage: Number(q.usage), limit: q.limit ? Number(q.limit) : undefined }
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

/** Files with this exact name anywhere in My Drive (not trashed). */
export async function findFilesByName(name: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  await listFiles(`name = '${q(name)}' and trashed = false`, (files) => void out.push(...files), undefined, 'id,name,parents,modifiedTime')
  return out
}

/** True when the folder holds nothing (trashed files aside). */
export async function isFolderEmpty(id: string): Promise<boolean> {
  let empty = true
  await listFiles(childrenQuery([id]), (files) => void (empty &&= files.length === 0), undefined, 'id')
  return empty
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

/** Reads bytes [start, end) of a file (HTTP Range request). */
export async function downloadRange(id: string, start: number, end: number): Promise<Uint8Array> {
  const res = await request(`${API}/files/${id}?alt=media&supportsAllDrives=true`, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  })
  return new Uint8Array(await res.arrayBuffer())
}

function multipartBody(metadata: object, content: Blob | string, contentType: string): { body: Blob; boundary: string } {
  const boundary = `mymedia-${Math.random().toString(36).slice(2)}`
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ])
  return { body, boundary }
}

const UPLOAD_FIELDS = 'id,name,modifiedTime,version'

async function upload(method: 'POST' | 'PATCH', path: string, metadata: object, content: Blob | string, contentType: string) {
  const { body, boundary } = multipartBody(metadata, content, contentType)
  const res = await request(`${UPLOAD}/files${path}?uploadType=multipart&fields=${UPLOAD_FIELDS}&supportsAllDrives=true`, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return res.json() as Promise<DriveFile>
}

export function createTextFile(name: string, parentId: string, content: string, mime = 'application/json'): Promise<DriveFile> {
  return upload('POST', '', { name, parents: [parentId], mimeType: mime }, content, `${mime}; charset=UTF-8`)
}

export function updateTextFile(id: string, content: string, mime = 'application/json'): Promise<DriveFile> {
  return upload('PATCH', `/${id}`, {}, content, `${mime}; charset=UTF-8`)
}

export function createBinaryFile(name: string, parentId: string, content: Blob, mime = 'application/octet-stream'): Promise<DriveFile> {
  return upload('POST', '', { name, parents: [parentId], mimeType: mime }, content, mime)
}

export function updateBinaryFile(id: string, content: Blob, mime = 'application/octet-stream'): Promise<DriveFile> {
  return upload('PATCH', `/${id}`, {}, content, mime)
}

/** Moves a file to another folder (same file, only its location changes). */
export async function moveFile(id: string, toFolderId: string, fromFolderId: string): Promise<void> {
  const params = new URLSearchParams({ addParents: toFolderId, removeParents: fromFolderId, supportsAllDrives: 'true', fields: 'id,parents' })
  await request(`${API}/files/${id}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
}

const MULTIPART_MAX = 5 * 1024 * 1024

/** PUT with upload progress (fetch cannot report upload progress). */
function putWithProgress(url: string, blob: Blob, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new DriveError(xhr.status, `upload failed ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('upload failed (network)'))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(blob)
  })
}

/**
 * Replaces the content of an existing file (same id: classification, album,
 * description stay attached to it). Drive keeps the previous content as an
 * older version of the file. An app property set to null is removed.
 */
export async function uploadNewContent(
  id: string,
  blob: Blob,
  metadata: { name?: string; mimeType?: string; appProperties?: Record<string, string | null> },
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<DriveFile> {
  const query = `supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`
  if (blob.size <= MULTIPART_MAX) {
    const { body, boundary } = multipartBody(metadata, blob, metadata.mimeType ?? blob.type)
    const res = await request(`${UPLOAD}/files/${id}?uploadType=multipart&${query}`, {
      method: 'PATCH',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, signal)
    onProgress?.(1)
    return res.json()
  }
  const init = await request(`${UPLOAD}/files/${id}?uploadType=resumable&${query}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': metadata.mimeType ?? blob.type,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify(metadata),
  }, signal)
  const location = init.headers.get('Location')
  if (!location) throw new Error('Drive did not return an upload address')
  return JSON.parse(await putWithProgress(location, blob, onProgress, signal)) as DriveFile
}

/** Server-side copy of a file into another folder. */
export async function copyFile(id: string, name: string, parentId: string): Promise<DriveFile> {
  const res = await request(`${API}/files/${id}/copy?supportsAllDrives=true&fields=id,name,parents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parentId] }),
  })
  return res.json()
}

/** Marks the version before the current one "keep forever" (no automatic deletion after 30 days). */
export async function keepPreviousVersion(id: string): Promise<void> {
  const r = await getJson<{ revisions: { id: string; modifiedTime: string }[] }>(
    `${API}/files/${id}/revisions?fields=revisions(id,modifiedTime)&pageSize=1000`,
  )
  const list = (r.revisions ?? []).sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime))
  const previous = list[list.length - 2]
  if (!previous) return
  await request(`${API}/files/${id}/revisions/${previous.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepForever: true }),
  })
}

/** Finds (or creates) a chain of folders below parentId, e.g. ["_Originals", "Birds", "דוכיפת"]. */
export async function ensureFolderPath(parentId: string, names: string[]): Promise<string> {
  let current = parentId
  for (const name of names) {
    let found: DriveFile | null = null
    await listFiles(
      `name = '${q(name)}' and '${q(current)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      (files) => {
        found ??= files[0] ?? null
      },
      undefined,
      'id,name',
    )
    current = (found as DriveFile | null)?.id ?? (await createFolder(name, current)).id
  }
  return current
}

/** Creates a media file in a folder, with its real dates (resumable upload above 5 MB). */
export async function createMediaFile(
  blob: Blob,
  metadata: {
    name: string
    parents: string[]
    mimeType: string
    createdTime?: string
    modifiedTime?: string
    appProperties?: Record<string, string>
  },
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<DriveFile> {
  const query = `supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`
  if (blob.size <= MULTIPART_MAX) {
    const { body, boundary } = multipartBody(metadata, blob, metadata.mimeType)
    const res = await request(`${UPLOAD}/files?uploadType=multipart&${query}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }, signal)
    onProgress?.(1)
    return res.json()
  }
  const init = await request(`${UPLOAD}/files?uploadType=resumable&${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': metadata.mimeType,
      'X-Upload-Content-Length': String(blob.size),
    },
    body: JSON.stringify(metadata),
  }, signal)
  const location = init.headers.get('Location')
  if (!location) throw new Error('Drive did not return an upload address')
  return JSON.parse(await putWithProgress(location, blob, onProgress, signal)) as DriveFile
}

/** Sets hidden app properties on a file (its content is not touched). */
export async function setAppProperties(id: string, appProperties: Record<string, string>): Promise<void> {
  await request(`${API}/files/${id}?supportsAllDrives=true&fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties }),
  })
}

/** Permanent deletion, only for MyMedia's own data files and after the user confirmed. */
export async function deleteFilePermanently(id: string): Promise<void> {
  await request(`${API}/files/${id}?supportsAllDrives=true`, { method: 'DELETE' })
}

// ---- Ownership transfer between two personal accounts ------------------------
// The owner offers the file (writer + pendingOwner); the new owner accepts by
// making their own permission "owner". Drive keeps the same file id.

/** Id of the signed-in user in permissions (the same on every file). */
export async function myPermissionId(): Promise<string> {
  const r = await getJson<{ user: { permissionId: string } }>(`${API}/about?fields=user(permissionId)`)
  return r.user.permissionId
}

/** Offers the ownership of a file or folder to `email` (they must accept). */
export async function offerOwnership(id: string, email: string, notify: boolean, message?: string): Promise<void> {
  const send = (withEmail: boolean) => {
    const params = new URLSearchParams({ sendNotificationEmail: String(withEmail), supportsAllDrives: 'true', fields: 'id' })
    if (withEmail && message) params.set('emailMessage', message)
    return request(`${API}/files/${id}/permissions?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email, pendingOwner: true }),
    })
  }
  try {
    await send(notify)
  } catch (e) {
    // Drive may insist on the e-mail for an ownership offer.
    if (!notify && e instanceof DriveError && e.status === 400) await send(true)
    else throw e
  }
}

/** Accepts the ownership offered on a file (the signed-in user becomes owner). */
export async function acceptOwnership(id: string, permissionId: string): Promise<void> {
  const params = new URLSearchParams({ transferOwnership: 'true', supportsAllDrives: 'true', fields: 'id' })
  await request(`${API}/files/${id}/permissions/${permissionId}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'owner' }),
  })
}

/** Puts a file in a folder, leaving the parents it had (seen or not). */
export async function moveInto(id: string, toFolderId: string): Promise<void> {
  const cur = await getFile(id, 'id,parents')
  const params = new URLSearchParams({ addParents: toFolderId, supportsAllDrives: 'true', fields: 'id,parents' })
  const old = (cur.parents ?? []).filter((p) => p !== toFolderId)
  if (old.length) params.set('removeParents', old.join(','))
  await request(`${API}/files/${id}?${params}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
}
