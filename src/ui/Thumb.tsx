import { Play } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import { cachedThumbUrl, loadThumb } from '../sync/thumbs'

interface Props {
  rec: MediaRecord
  onOpen: (id: string) => void
}

export const Thumb = memo(function Thumb({ rec, onOpen }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [url, setUrl] = useState<string | null | undefined>(() => cachedThumbUrl(rec.id))
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    if (url) return
    loadThumb(rec, () => mounted.current).then((u) => {
      if (mounted.current) setUrl(u)
    })
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id, rec.modifiedTime])

  return (
    <button type="button" className="cell" onClick={() => onOpen(rec.id)} title={rec.name}>
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : url === null ? (
        <span className="fallback">
          <bdi>{rec.name}</bdi>
        </span>
      ) : null}
      {rec.type === 'video' && (
        <span className="badge" aria-label={t('gallery.video')}>
          <Play size={12} className="flip-rtl" />
          {rec.durationMs ? fmt.duration(rec.durationMs) : ''}
        </span>
      )}
    </button>
  )
})
