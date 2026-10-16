import { describe, expect, it } from 'vitest'
import { FOLDER_MIME } from '../src/lib/media'
import { isMyMediaFile, TRANSFER_FILE_NAME } from '../src/transfer/transfer'

describe('isMyMediaFile', () => {
  it("leaves out MyMedia's own files of the account, not the photos nor the transfer file", () => {
    for (const name of ['mymedia.json', 'mymedia-faces.json', 'mymedia-index.json', 'mymedia-index.bin', 'mymedia-model-abc.json'])
      expect(isMyMediaFile({ name, mimeType: 'application/json' })).toBe(true)
    expect(isMyMediaFile({ name: TRANSFER_FILE_NAME, mimeType: 'application/json' })).toBe(false)
    expect(isMyMediaFile({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg' })).toBe(false)
    expect(isMyMediaFile({ name: 'mymedia-trip', mimeType: FOLDER_MIME })).toBe(false)
  })
})
