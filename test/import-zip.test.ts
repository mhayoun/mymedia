import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { zipFolderName, zipMedia } from '../src/import/zip'

describe('ZIP of photos', () => {
  it('names the folder after the ZIP, except a Google Drive download', () => {
    expect(zipFolderName('נחל יהודיה.zip')).toBe('נחל יהודיה')
    expect(zipFolderName('Trip-002.zip')).toBe('Trip')
    expect(zipFolderName('drive-download-20261018T101112Z-001.zip')).toBeNull()
  })

  it('gives the photos and videos with their folders, leaving out the rest', async () => {
    const zip = new JSZip()
    zip.file('a.jpg', 'x')
    zip.file('Day 1/b.MP4', 'y')
    zip.file('notes.txt', 'z')
    zip.file('__MACOSX/._a.jpg', 'w')
    const files = await zipMedia(await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' })), 'Trip.zip', () => undefined)
    expect(files.map((f) => (f as File & { webkitRelativePath: string }).webkitRelativePath).sort()).toEqual(['Trip/Day 1/b.MP4', 'Trip/a.jpg'])
  })
})
