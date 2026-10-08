// Facebook export ("Download your information", HTML format): photos posted in
// groups, with the group, the date and the text of each post.

import type JSZip from 'jszip'
import { katiaDate } from '../lib/katia'
import { mediaTypeOf } from '../lib/media'

export interface FacebookPost {
  group: string | null
  /** Local "YYYY-MM-DDTHH:mm:ss". */
  date: string | null
  description: string | null
}

export interface FacebookExport {
  zip: JSZip
  /** File name (without path) → its post. */
  posts: Map<string, FacebookPost>
  /** Group → number of photos and videos. */
  groups: Map<string, number>
}

export class FacebookFormatError extends Error {}

const POSTS_HTML = /group_posts_and_comments\.html$/i
// "X posted in Group." in the languages of the export.
const POSTED_IN = /(?:posted in|a publié dans|a partagé dans|פרסמה? ב(?:קבוצה)?)\s*(.+)$/i
const MARKS = /[‎‏‪-‮]/g

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const isMedia = (p: string) => mediaTypeOf('', baseName(p)) !== null

export function parsePostsHtml(html: string): Map<string, FacebookPost> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let sections = [...doc.querySelectorAll('section._a6-g')]
  if (!sections.length) sections = [...doc.querySelectorAll('section')]
  const posts = new Map<string, FacebookPost>()
  for (const sec of sections) {
    const h2 = sec.querySelector('h2')?.textContent?.replace(MARKS, '').trim() ?? ''
    const group = POSTED_IN.exec(h2)?.[1].replace(/\.$/, '').trim() || null
    const dateText = sec.querySelector('._a72d')?.textContent?.trim() ?? null
    let description: string | null = null
    const walker = doc.createTreeWalker(sec, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const t = (walker.currentNode.nodeValue ?? '').replace(MARKS, '').trim()
      if (!t || t === h2 || t === dateText || POSTED_IN.test(t)) continue
      description = t
      break
    }
    const post = { group, date: katiaDate(dateText), description }
    sec.querySelectorAll('a[href], img[src], video[src], source[src]').forEach((el) => {
      const src = el.getAttribute('href') ?? el.getAttribute('src') ?? ''
      if (isMedia(src)) posts.set(baseName(src), post)
    })
  }
  return posts
}

/** Opens the ZIP and reads the posts. Throws FacebookFormatError when it is not a Facebook export. */
export async function readFacebookZip(file: File): Promise<FacebookExport> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(file)
  const htmlFiles = zip.file(POSTS_HTML)
  if (!htmlFiles.length) throw new FacebookFormatError('group_posts_and_comments.html not found')
  const posts = new Map<string, FacebookPost>()
  for (const f of htmlFiles) for (const [k, v] of parsePostsHtml(await f.async('string'))) posts.set(k, v)
  const inZip = new Set(
    zip
      .file(/./)
      .filter((f) => isMedia(f.name))
      .map((f) => baseName(f.name)),
  )
  for (const name of [...posts.keys()]) if (!inZip.has(name)) posts.delete(name)
  const groups = new Map<string, number>()
  for (const p of posts.values()) {
    const g = p.group ?? ''
    groups.set(g, (groups.get(g) ?? 0) + 1)
  }
  return { zip, posts, groups }
}

/** The photos and videos of the chosen groups, as files ('' = posts without a group). */
export async function extractFiles(fb: FacebookExport, groups: Set<string>, onProgress: (done: number, total: number) => void): Promise<File[]> {
  const wanted = fb.zip.file(/./).filter((f) => {
    const p = fb.posts.get(baseName(f.name))
    return p && groups.has(p.group ?? '')
  })
  const seen = new Set<string>()
  const files: File[] = []
  for (const [i, f] of wanted.entries()) {
    const name = baseName(f.name)
    if (!seen.has(name)) {
      seen.add(name)
      files.push(new File([await f.async('blob')], name, { lastModified: f.date?.getTime() ?? Date.now() }))
    }
    onProgress(i + 1, wanted.length)
  }
  return files
}
