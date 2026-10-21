// Which MyMedia is open: the user's own, or one another account shared with
// them in Drive. Shared as "Viewer", it is opened read-only: Drive itself
// refuses any change, and the app hides every action that would make one.
// Each library has its own local database, so they never mix.

import { childrenQuery, listFiles } from '../drive/api'
import { FOLDER_MIME } from '../lib/media'
import { META_FILE_NAME } from '../lib/metadata'

export interface SharedLibrary {
  id: string
  name: string
  ownerName?: string
  ownerEmail?: string
  readOnly: boolean
}

const PARENTS_PER_QUERY = 25
const key = (email: string) => `mymedia.library:${email.toLowerCase()}`
const LOST_KEY = 'mymedia.libraryLost'

/** The shared library chosen by this account (its folder id), or null for its own. */
export function chosenLibrary(email: string): string | null {
  try {
    return localStorage.getItem(key(email))
  } catch {
    return null
  }
}

/** Opens another library: the app starts again on it. */
export function openLibrary(email: string, sharedRootId: string | null): void {
  try {
    if (sharedRootId) localStorage.setItem(key(email), sharedRootId)
    else localStorage.removeItem(key(email))
  } catch {
    // Not kept: the app opens the user's own library.
  }
  location.reload()
}

/** The shared library is no longer reachable (sharing removed): back to the user's own, saying why. */
export function libraryLost(email: string): void {
  try {
    sessionStorage.setItem(LOST_KEY, '1')
  } catch {
    // The message is not shown; the app still opens the user's own library.
  }
  openLibrary(email, null)
}

/** True once after libraryLost (the message to show at start). */
export function takeLibraryLost(): boolean {
  try {
    const lost = sessionStorage.getItem(LOST_KEY) === '1'
    sessionStorage.removeItem(LOST_KEY)
    return lost
  } catch {
    return false
  }
}

/** Folders shared with this account that are a MyMedia (they hold mymedia.json). */
export async function findSharedLibraries(): Promise<SharedLibrary[]> {
  const folders: SharedLibrary[] = []
  await listFiles(
    `sharedWithMe = true and mimeType = '${FOLDER_MIME}' and trashed = false`,
    (files) => {
      for (const f of files) {
        const owner = f.owners?.[0]
        folders.push({ id: f.id, name: f.name, ownerName: owner?.displayName, ownerEmail: owner?.emailAddress, readOnly: !f.capabilities?.canEdit })
      }
    },
    undefined,
    'id,name,owners(displayName,emailAddress),capabilities(canEdit)',
  )
  const libraries = new Set<string>()
  for (let i = 0; i < folders.length; i += PARENTS_PER_QUERY) {
    const batch = folders.slice(i, i + PARENTS_PER_QUERY).map((f) => f.id)
    await listFiles(
      `name = '${META_FILE_NAME}' and ${childrenQuery(batch)}`,
      (files) => {
        for (const f of files) for (const p of f.parents ?? []) libraries.add(p)
      },
      undefined,
      'id,parents',
    )
  }
  return folders.filter((f) => libraries.has(f.id))
}
