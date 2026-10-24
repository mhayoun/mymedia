// Work done in the background after each load from Drive: look for new big
// files to compress (a list is proposed to the user), then learn new
// fingerprints and classify, then make the thumbnail packs. A file compressed later keeps its fingerprint.

import { afterLoadCompression } from './compress/engine'
import { repairKatiaProvenance } from './import/katia'
import { startIndexer } from './ml/indexer'
import { pullFaces } from './faces/store'
import { app, withStep } from './store'
import { kick as sendMoves } from './sync/moveQueue'
import { buildPacks, preparePacks } from './sync/thumbPacks'
import { fixVideoDates } from './sync/videoDates'

let running: Promise<void> | null = null

export function afterSync(): Promise<void> {
  // Read-only: nothing is analysed, sorted or compressed; the people found by the owner are shown.
  if (app().readOnly) {
    running ??= Promise.all([preparePacks(), app().settings.facesEnabled ? pullFaces() : null])
      .then(() => undefined)
      .catch((e) => console.warn('[MyMedia] faces download failed', e))
      .finally(() => {
        running = null
      })
    return running
  }
  // Moves left from an earlier visit (offline, closed too soon).
  sendMoves()
  running ??= (async () => {
    // The thumbnail packs made by other devices, then those to make or bring up to date.
    await preparePacks()
    try {
      await afterLoadCompression()
    } catch (e) {
      console.error('[MyMedia] automatic compression failed', e)
    }
    await withStep('classify.checkingDates', async () => {
      await fixVideoDates().catch((e) => console.warn('[MyMedia] video dates', e))
      await repairKatiaProvenance().catch((e) => console.warn('[MyMedia] Katia provenance', e))
    })
    // The analysis first: making packs now downloads each original (Google's previews cannot
    // be read any more), which can take a long time.
    await startIndexer()
    await buildPacks()
  })().finally(() => {
    running = null
  })
  return running
}
