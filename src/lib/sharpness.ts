// How sharp a picture is, from a small grey copy of it.

/** Tiles per side: the sharpest tile gives the score (a sharp bird on a blurred background is sharp). */
const TILES = 4

/**
 * Sharpness of a grey picture (`w` × `h`, one value 0..255 per pixel):
 * variance of the Laplacian in the sharpest of 4 × 4 tiles. Low = blurred.
 */
export function sharpness(grey: ArrayLike<number>, w: number, h: number): number {
  if (w < 3 * TILES || h < 3 * TILES) return 0
  const sum = new Float64Array(TILES * TILES)
  const sq = new Float64Array(TILES * TILES)
  const count = new Uint32Array(TILES * TILES)
  for (let y = 1; y < h - 1; y++) {
    const ty = Math.min(TILES - 1, Math.floor((y * TILES) / h))
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i]
      const t = ty * TILES + Math.min(TILES - 1, Math.floor((x * TILES) / w))
      sum[t] += lap
      sq[t] += lap * lap
      count[t]++
    }
  }
  let best = 0
  for (let t = 0; t < TILES * TILES; t++) {
    if (!count[t]) continue
    const mean = sum[t] / count[t]
    best = Math.max(best, sq[t] / count[t] - mean * mean)
  }
  return best
}

/** Grey values (Rec. 601) of RGBA pixels. */
export function toGrey(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(rgba.length / 4)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
  return out
}
