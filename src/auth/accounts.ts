// The Google accounts already used in MyMedia on this device, for the account
// menu. Google does not tell a web app which accounts the browser holds: only
// those opened here once are known (each has its own database).

import { MyMediaDB } from '../db/db'
import type { User } from '../store'

const KEY = 'mymedia.accounts'

function saved(): User[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as User[]
  } catch {
    return []
  }
}

/** Called at each sign-in: the account (name and photo up to date) joins the list. */
export function rememberAccount(user: User): void {
  const list = saved().filter((u) => u.email.toLowerCase() !== user.email.toLowerCase())
  try {
    localStorage.setItem(KEY, JSON.stringify([user, ...list]))
  } catch {
    // Not remembered: the databases below still find it.
  }
}

/** Every account known on this device, the last used first. */
export async function knownAccounts(): Promise<User[]> {
  const out = saved()
  const seen = new Set(out.map((u) => u.email.toLowerCase()))
  // Accounts used before the list existed: one database each ("mymedia:<email>").
  const dbs = await indexedDB.databases?.().catch(() => []) ?? []
  for (const { name } of dbs) {
    const email = name?.match(/^mymedia:([^:]+)$/)?.[1]
    if (!email || seen.has(email)) continue
    seen.add(email)
    const d = new MyMediaDB(name!)
    try {
      out.push((await d.getKv<User>('user')) ?? { email, name: '' })
    } catch {
      out.push({ email, name: '' })
    } finally {
      d.close()
    }
  }
  return out
}
