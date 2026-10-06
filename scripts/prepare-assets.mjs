// Copies the ONNX Runtime engine and downloads the image model into public/,
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

// DINOv2-small (Meta, Apache-2.0), int8 ONNX export by onnx-community.
const MODEL = {
  url: 'https://huggingface.co/onnx-community/dinov2-small-ONNX/resolve/main/onnx/model_quantized.onnx',
  sha256: '7cfc69bd1874d20b9dbecdab057f21aeac7b90c2f560bd0fb66af86c78024f62',
  path: join(root, 'public/models/dinov2-small/model_quantized.onnx'),
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

if (existsSync(MODEL.path) && sha256(readFileSync(MODEL.path)) === MODEL.sha256) {
  console.log('[assets] model ready')
} else {
  console.log('[assets] downloading image model (24 MB)…')
  const res = await fetch(MODEL.url)
  if (!res.ok) throw new Error(`model download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (sha256(buf) !== MODEL.sha256) throw new Error('model checksum mismatch')
  mkdirSync(dirname(MODEL.path), { recursive: true })
  writeFileSync(MODEL.path, buf)
  console.log('[assets] model ready')
}
