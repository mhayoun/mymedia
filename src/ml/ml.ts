// App side of the ML worker.

import type { LabelStats, Prediction } from '../lib/classifier'
import type { PackedSet, Query, Request } from './protocol'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function call<T>(req: Request, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./ml.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.error) p.reject(new Error(e.data.error))
      else p.resolve(e.data.result)
    }
    const base = import.meta.env.BASE_URL
    const abs = (path: string) => new URL(`${base}${path}`, location.href).href
    void call({ type: 'init', modelUrl: abs('models/dinov2-small/model_quantized.onnx'), wasmUrl: abs('ort/ort-wasm-simd-threaded.wasm') })
  }
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ id, req }, transfer)
  })
}

/** Fingerprint of an image (or the average of several video frames). */
export function embed(images: Blob[]): Promise<Int8Array | null> {
  return call({ type: 'embed', images })
}

export function predictMany(set: PackedSet, queries: Query[], tau: number): Promise<Prediction[][]> {
  return call({ type: 'predict', set, queries, tau })
}

export function calibrateTau(set: PackedSet): Promise<number> {
  return call({ type: 'calibrate', set })
}

export function evaluateSet(set: PackedSet, tau: number): Promise<LabelStats[]> {
  return call({ type: 'evaluate', set, tau })
}
