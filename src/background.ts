// Work done in the background after each load from Drive: look for new big
// files to compress (a list is proposed to the user), then learn new
// fingerprints and classify. A file compressed later keeps its fingerprint.

import { afterLoadCompression } from './compress/engine'
import { startIndexer } from './ml/indexer'
import { fixVideoDates } from './sync/videoDates'

let running: Promise<void> | null = null

export function afterSync(): Promise<void> {
  running ??= (async () => {
    try {
      await afterLoadCompression()
    } catch (e) {
      console.error('[MyMedia] automatic compression failed', e)
    }
    await fixVideoDates().catch((e) => console.warn('[MyMedia] video dates', e))
    await startIndexer()
  })().finally(() => {
    running = null
  })
  return running
}
