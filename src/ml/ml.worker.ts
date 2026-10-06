/// <reference lib="webworker" />
// Runs the image model (DINOv2-small, ONNX Runtime WebAssembly) and the
// classifier maths away from the screen, so the app never freezes.

import * as ort from 'onnxruntime-web/wasm'
import { average, calibrate, evaluate, predict, quantize, type LabeledVec, type Vec } from '../lib/classifier'
import { findFaces, initFaceModels } from './faceModel'
import type { PackedSet, Request } from './protocol'

const SIZE = 224
const RESIZE = 256
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const MODEL_CACHE = 'mymedia-models-v1'

let session: Promise<ort.InferenceSession> | null = null
let config: { modelUrl: string; wasmUrl: string; faceDetUrl: string; faceRecUrl: string } | null = null

async function cachedFetch(url: string): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open(MODEL_CACHE)
    const hit = await cache.match(url)
    if (hit) return hit.arrayBuffer()
    const res = await fetch(url)
    if (!res.ok) throw new Error(`model download failed: ${res.status}`)
    await cache.put(url, res.clone())
    return res.arrayBuffer()
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('model download')) throw e
    const res = await fetch(url) // Cache API unavailable (private mode)
    return res.arrayBuffer()
  }
}

function getSession() {
  if (!config) throw new Error('ML worker not initialised')
  session ??= (async () => {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { wasm: config!.wasmUrl }
    return ort.InferenceSession.create(new Uint8Array(await cachedFetch(config!.modelUrl)), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
  })()
  return session
}

/** Shortest side to 256, centre crop 224, ImageNet normalisation, CHW. */
async function preprocess(blob: Blob): Promise<Float32Array> {
  const bitmap = await createImageBitmap(blob)
  const scale = RESIZE / Math.min(bitmap.width, bitmap.height)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
  const out = new Float32Array(3 * SIZE * SIZE)
  const plane = SIZE * SIZE
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) out[c * plane + i] = (data[i * 4 + c] / 255 - MEAN[c]) / STD[c]
  }
  return out
}

/** Fingerprint = [class token ‖ mean of patch tokens], each normalised. */
async function embedOne(blob: Blob): Promise<Vec> {
  const s = await getSession()
  const input = new ort.Tensor('float32', await preprocess(blob), [1, 3, SIZE, SIZE])
  const out = await s.run({ [s.inputNames[0]]: input })
  const t = out[s.outputNames[0]]
  const [, tokens, dim] = t.dims as number[]
  const h = t.data as Float32Array
  const cls = h.slice(0, dim)
  const mean = new Float32Array(dim)
  for (let k = 1; k < tokens; k++) for (let d = 0; d < dim; d++) mean[d] += h[k * dim + d]
  const unit = (v: Float32Array) => {
    let n = 0
    for (const x of v) n += x * x
    n = Math.sqrt(n) || 1
    return v.map((x) => x / n)
  }
  const both = new Float32Array(dim * 2)
  both.set(unit(cls), 0)
  both.set(unit(mean), dim)
  return quantize(both)
}

function unpack(set: PackedSet): LabeledVec[] {
  return set.ids.map((id, i) => ({ id, label: set.labels[i], vec: set.data.subarray(i * set.dim, (i + 1) * set.dim) }))
}

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'init':
      config = { modelUrl: req.modelUrl, wasmUrl: req.wasmUrl, faceDetUrl: req.faceDetUrl, faceRecUrl: req.faceRecUrl }
      return true
    case 'faces': {
      if (!config) throw new Error('ML worker not initialised')
      initFaceModels(cachedFetch, config.faceDetUrl, config.faceRecUrl, config.wasmUrl)
      const all = []
      for (const image of req.images) {
        try {
          all.push(await findFaces(image))
        } catch {
          all.push([])
        }
      }
      return all
    }
    case 'embed': {
      const vecs: Vec[] = []
      for (const blob of req.images) {
        try {
          vecs.push(await embedOne(blob))
        } catch {
          // one unreadable frame: use the others
        }
      }
      return vecs.length ? average(vecs) : null
    }
    case 'predict': {
      const labeled = unpack(req.set)
      return req.queries.map((q) => predict(q.vec, labeled, q.allowed ? new Set(q.allowed) : null, req.tau, q.id))
    }
    case 'calibrate':
      return calibrate(unpack(req.set))
    case 'evaluate':
      return evaluate(unpack(req.set), req.tau)
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data
  try {
    const result = await handle(req)
    const transfer = result instanceof Int8Array ? [result.buffer] : []
    self.postMessage({ id, result }, { transfer })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
