// Work done in the background after each load from Drive, in this order:
// compress new big files first (so their fingerprint is made only once),
// then learn new fingerprints and classify.

import { autoCompress } from './compress/engine'
import { startIndexer } from './ml/indexer'

let running: Promise<void> | null = null

export function afterSync(): Promise<void> {
  running ??= (async () => {
    try {
      await autoCompress()
    } catch (e) {
      console.error('[MyMedia] automatic compression failed', e)
    }
    await startIndexer()
  })().finally(() => {
    running = null
  })
  return running
}
