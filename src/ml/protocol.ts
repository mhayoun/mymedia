// Messages between the app and the ML worker.

/** A labeled set sent to the worker in one block (fast to transfer). */
export interface PackedSet {
  ids: string[]
  labels: string[]
  dim: number
  data: Int8Array
}

export interface Query {
  id: string
  vec: Int8Array
  /** Allowed labels (folder ids); null = all. */
  allowed: string[] | null
}

export type Request =
  | { type: 'init'; modelUrl: string; wasmUrl: string }
  | { type: 'embed'; images: Blob[] }
  | { type: 'predict'; set: PackedSet; queries: Query[]; tau: number }
  | { type: 'calibrate'; set: PackedSet }
  | { type: 'evaluate'; set: PackedSet; tau: number }

export const MODEL_ID = 'dinov2-small-q8/cls+mean/v1'
export const EMBED_DIM = 768
