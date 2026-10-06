// Copies the ONNX Runtime engine and downloads the image and face models into public/,
// so the app serves them itself: users' devices never contact another site.
// Runs automatically before `npm run dev` and `npm run build`.

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ONNX Runtime WebAssembly engine (the JS part is bundled by Vite).
const ortDir = join(root, 'public/ort')
mkdirSync(ortDir, { recursive: true })
copyFileSync(
  join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
  join(ortDir, 'ort-wasm-simd-threaded.wasm'),
)

const MODELS = [
  {
    // DINOv2-small (Meta, Apache-2.0), int8 ONNX export by onnx-community: image fingerprints.
    url: 'https://huggingface.co/onnx-community/dinov2-small-ONNX/resolve/main/onnx/model_quantized.onnx',
    sha256: '7cfc69bd1874d20b9dbecdab057f21aeac7b90c2f560bd0fb66af86c78024f62',
    path: 'public/models/dinov2-small/model_quantized.onnx',
  },
  {
    // YuNet 2023mar (OpenCV Zoo, MIT): face detection.
    url: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    path: 'public/models/faces/yunet_2023mar.onnx',
  },
  {
    // SFace 2021dec (OpenCV Zoo, Apache-2.0): face fingerprints. The float version is
    // ~3× faster than the int8 one in WebAssembly, with the same accuracy.
    url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    path: 'public/models/faces/sface_2021dec.onnx',
  },
]

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

for (const model of MODELS) {
  const path = join(root, model.path)
  if (existsSync(path) && sha256(readFileSync(path)) === model.sha256) continue
  console.log(`[assets] downloading ${model.path}…`)
  const res = await fetch(model.url)
  if (!res.ok) throw new Error(`model download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256(buf) !== model.sha256) throw new Error(`checksum mismatch for ${model.path}`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
}
console.log('[assets] models ready')
