import { Check, Play, ZoomIn } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { cachedThumbUrl, loadThumb, screenOrder } from '../sync/thumbs'

interface Props {
  rec: MediaRecord
  /** A tap on the picture (opens it, or ticks it in grids that select). */
  onOpen: (id: string, e: { shiftKey: boolean }) => void
  /** Ticked or not; undefined: no tick shown. */
  selected?: boolean
  /** The Enlarge button in the corner (when a tap ticks): opens the photo. */
  onZoom?: (id: string) => void
}

export const Thumb = memo(function Thumb({ rec, onOpen, selected, onZoom }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const bySize = useApp((s) => s.settings.sort === 'largest' || s.settings.sort === 'smallest')
  const [url, setUrl] = useState<string | null | undefined>(() => cachedThumbUrl(rec.id))
  const mounted = useRef(true)
  const el = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    mounted.current = true
    if (url) return
    loadThumb(rec, () => mounted.current, () => screenOrder(el.current)).then((u) => {
      if (mounted.current) setUrl(u)
    })
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id, rec.modifiedTime])

  return (
    <button
      type="button"
      ref={el}
      className={`cell ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={(e) => onOpen(rec.id, e)}
      title={rec.name}
    >
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
      {bySize && <span className="badge size">{fmt.bytes(rec.size)}</span>}
      {selected !== undefined && <span className="check">{selected && <Check size={14} />}</span>}
      {onZoom && (
        <span
          className="zoom-btn"
          role="button"
          aria-label={t('classify.zoom')}
          title={t('classify.zoom')}
          onClick={(e) => {
            e.stopPropagation()
            onZoom(rec.id)
          }}
        >
          <ZoomIn size={16} />
        </span>
      )}
    </button>
  )
})
