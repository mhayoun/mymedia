// Face detection (YuNet) and face fingerprints (SFace), on the device.
// Runs inside the ML worker; face data never leaves the device except to
// the user's own Drive (mymedia-faces.json).

import * as ort from 'onnxruntime-web/wasm'
import { alignmentMatrix, decodeYunet, nms, type Detection } from '../lib/faces'
import { quantize } from '../lib/classifier'

const DET_SIZE = 640
const MIN_SCORE = 0.75
/** Ignore tiny faces (in source pixels): too small to recognise reliably. */
const MIN_FACE = 28
const CROP_SIZE = 128

export interface FoundFace {
  /** Box relative to the image (0..1): x, y, w, h. */
  box: [number, number, number, number]
  score: number
  emb: Int8Array
  /** Small square picture of the face (for the people screens). */
  crop: Blob
}

export type ModelLoader = (url: string) => Promise<ArrayBuffer>

let sessions: Promise<{ det: ort.InferenceSession; rec: ort.InferenceSession }> | null = null

export function initFaceModels(load: ModelLoader, detUrl: string, recUrl: string, wasmUrl: string) {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = { wasm: wasmUrl }
  ort.env.logLevel = 'error' // the OpenCV models trigger harmless warnings
  sessions ??= (async () => ({
    det: await ort.InferenceSession.create(new Uint8Array(await load(detUrl)), { executionProviders: ['wasm'] }),
    rec: await ort.InferenceSession.create(new Uint8Array(await load(recUrl)), { executionProviders: ['wasm'] }),
  }))()
  return sessions
}

async function detect(det: ort.InferenceSession, bitmap: ImageBitmap): Promise<Detection[]> {
  const scale = DET_SIZE / Math.max(bitmap.width, bitmap.height)
  const canvas = new OffscreenCanvas(DET_SIZE, DET_SIZE)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale)
  const { data } = ctx.getImageData(0, 0, DET_SIZE, DET_SIZE)
  const plane = DET_SIZE * DET_SIZE
  const input = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 4 + 2] // B
    input[plane + i] = data[i * 4 + 1] // G
    input[2 * plane + i] = data[i * 4] // R
  }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]) })
  const raw: Record<string, Float32Array> = {}
  for (const k of det.outputNames) raw[k] = out[k].data as Float32Array
  return nms(decodeYunet(raw, DET_SIZE, MIN_SCORE)).map((d) => ({
    ...d,
    x: d.x / scale,
    y: d.y / scale,
    w: d.w / scale,
    h: d.h / scale,
    kps: d.kps.map((v) => v / scale),
  }))
}

async function fingerprint(rec: ort.InferenceSession, bitmap: ImageBitmap, d: Detection): Promise<Int8Array> {
  const canvas = new OffscreenCanvas(112, 112)
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(...alignmentMatrix(d.kps))
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, 112, 112)
  const plane = 112 * 112
  const input = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 4] // R
    input[plane + i] = data[i * 4 + 1] // G
    input[2 * plane + i] = data[i * 4 + 2] // B
  }
  const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 112, 112]) })
  return quantize(out[rec.outputNames[0]].data as Float32Array)
}

async function crop(bitmap: ImageBitmap, d: Detection): Promise<Blob> {
  const side = Math.max(d.w, d.h) * 1.5
  const cx = d.x + d.w / 2
  const cy = d.y + d.h / 2
  const canvas = new OffscreenCanvas(CROP_SIZE, CROP_SIZE)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, cx - side / 2, cy - side / 2, side, side, 0, 0, CROP_SIZE, CROP_SIZE)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
}

/** All the faces in one picture. */
export async function findFaces(image: Blob): Promise<FoundFace[]> {
  if (!sessions) throw new Error('face models not initialised')
  const { det, rec } = await sessions
  const bitmap = await createImageBitmap(image)
  try {
    const faces: FoundFace[] = []
    for (const d of await detect(det, bitmap)) {
      if (Math.min(d.w, d.h) < MIN_FACE) continue
      faces.push({
        box: [d.x / bitmap.width, d.y / bitmap.height, d.w / bitmap.width, d.h / bitmap.height],
        score: Math.round(d.score * 1000) / 1000,
        emb: await fingerprint(rec, bitmap, d),
        crop: await crop(bitmap, d),
      })
    }
    return faces
  } finally {
    bitmap.close()
  }
}
