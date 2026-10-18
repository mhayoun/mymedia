// Any ZIP of photos and videos (e.g. downloaded from Google Drive): its files
// are imported as if its folder had been chosen, sub-folders included.

import type JSZip from 'jszip'
import { mediaTypeOf } from '../lib/media'

const SKIP = /(^|\/)(__MACOSX|\.)/

/**
 * The folder the ZIP stands for: its name without ".zip" (and a part number
 * "-001"), or none for Google Drive's "drive-download-…" (its content is what
 * was chosen in Drive).
 */
export function zipFolderName(name: string): string | null {
  const base = name.replace(/\.zip$/i, '').replace(/-\d{3}$/, '')
  return /^drive-download-/i.test(base) || !base ? null : base
}

/** Photos and videos of the ZIP, each with its path inside it (as a chosen folder gives). */
export async function zipMedia(zip: JSZip, zipName: string, onProgress: (done: number, total: number) => void): Promise<File[]> {
  const top = zipFolderName(zipName)
  const entries = zip.file(/./).filter((f) => !SKIP.test(f.name) && mediaTypeOf('', f.name.split('/').pop() ?? '') !== null)
  const files: File[] = []
  for (const [i, f] of entries.entries()) {
    const name = f.name.split('/').pop()!
    const file = new File([await f.async('blob')], name, { lastModified: f.date?.getTime() ?? Date.now() })
    Object.defineProperty(file, 'webkitRelativePath', { value: top ? `${top}/${f.name}` : f.name })
    files.push(file)
    onProgress(i + 1, entries.length)
  }
  return files
}
