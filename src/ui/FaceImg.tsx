import { User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { db, type FaceRecord } from '../db/db'
import { faceCrop } from '../faces/engine'
import { loadThumb } from '../sync/thumbs'

type Picture = { kind: 'crop'; url: string } | { kind: 'thumb'; url: string; ratio: number }

const cache = new Map<string, Picture>()

async function picture(face: FaceRecord): Promise<Picture | null> {
  try {
    const blob = await faceCrop(face)
    if (blob) return { kind: 'crop', url: URL.createObjectURL(blob) }
  } catch (e) {
    console.warn('[MyMedia] face picture', e)
  }
  // No face picture on this device (video, or the picture could not be made):
  // show the media's thumbnail, zoomed on the face.
  const rec = await db().media.get(face.mediaId)
  if (!rec) return null
  const url = await loadThumb(rec, () => true)
  if (!url) return null
  // Measured on the thumbnail itself (Drive's sizes can be before rotation).
  return { kind: 'thumb', url, ratio: await imageRatio(url) }
}

function imageRatio(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth / (img.naturalHeight || 1))
    img.onerror = () => resolve(1)
    img.src = url
  })
}

/** CSS that shows only the face area of a whole picture inside a square. */
function zoomOnFace(box: FaceRecord['box'], ratio: number): React.CSSProperties {
  const [x, y, w, h] = box
  // Square around the face, 1.5× its size, in fractions of width and height.
  const sideW = Math.max(w, (h / ratio)) * 1.5
  const sideH = sideW * ratio
  const cx = x + w / 2
  const cy = y + h / 2
  const left = Math.min(Math.max(cx - sideW / 2, 0), Math.max(0, 1 - sideW))
  const top = Math.min(Math.max(cy - sideH / 2, 0), Math.max(0, 1 - sideH))
  return {
    width: `${100 / sideW}%`,
    height: `${100 / sideH}%`,
    maxWidth: 'none',
    transform: `translate(${-left * 100}%, ${-top * 100}%)`,
    transformOrigin: '0 0',
    objectFit: 'fill',
  }
}

/** Round picture of a face. */
export function FaceImg({ face, size = 64 }: { face: FaceRecord; size?: number }) {
  const [pic, setPic] = useState(() => cache.get(face.id) ?? null)
  useEffect(() => {
    if (pic) return
    let alive = true
    picture(face).then((p) => {
      if (!p) return
      cache.set(face.id, p)
      if (alive) setPic(p)
    })
    return () => {
      alive = false
    }
  }, [face, pic])
  return (
    <span className="face" style={{ inlineSize: size, blockSize: size }}>
      {pic?.kind === 'crop' && <img src={pic.url} alt="" />}
      {pic?.kind === 'thumb' && <img src={pic.url} alt="" className="zoomed" style={zoomOnFace(face.box, pic.ratio)} />}
      {!pic && <User size={size * 0.5} />}
    </span>
  )
}
