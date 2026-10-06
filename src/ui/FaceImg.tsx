import { User } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FaceRecord } from '../db/db'
import { faceCrop } from '../faces/engine'

const urls = new Map<string, string>()

/** Round picture of a face (made on this device from the photo). */
export function FaceImg({ face, size = 64 }: { face: FaceRecord; size?: number }) {
  const [url, setUrl] = useState(() => urls.get(face.id))
  useEffect(() => {
    if (url) return
    let alive = true
    faceCrop(face)
      .then((blob) => {
        if (!blob || !alive) return
        const u = URL.createObjectURL(blob)
        urls.set(face.id, u)
        setUrl(u)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [face, url])
  return (
    <span className="face" style={{ inlineSize: size, blockSize: size }}>
      {url ? <img src={url} alt="" /> : <User size={size * 0.5} />}
    </span>
  )
}
