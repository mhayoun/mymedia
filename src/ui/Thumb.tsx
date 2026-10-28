import { Check, Loader2, Play, ZoomIn } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { cachedThumbUrl, loadThumb, reloadThumb, screenOrder } from '../sync/thumbs'

interface Props {
  rec: MediaRecord
  onOpen: (id: string, e: { shiftKey: boolean }) => void
  /** Selection mode: true/false; undefined when not selecting. */
  selected?: boolean
  /** Long press (touch) or Ctrl/⌘-click: start selecting with this media. */
  onLongPress?: (id: string) => void
  /** The Enlarge button in the corner, where a tap ticks ("To classify", "Auto"): opens the photo. */
  onZoom?: (id: string) => void
}

const LONG_PRESS_MS = 500
/**
 * A picture that does not load (Google refuses many previews asked at once):
 * tried again after these delays, the last time made from the original.
 */
const RETRY_MS = [1500, 5000, 15000]

export const Thumb = memo(function Thumb({ rec, onOpen, selected, onLongPress, onZoom }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const bySize = useApp((s) => s.settings.sort === 'largest' || s.settings.sort === 'smallest')
  const [url, setUrl] = useState<string | null | undefined>(() => cachedThumbUrl(rec.id))
  // The picture is drawn (until then a spinner turns over the cell).
  const [drawn, setDrawn] = useState(false)
  const mounted = useRef(true)
  // Tries after a picture that did not load; also renews the <img> (same address again).
  const [tries, setTries] = useState(0)
  const el = useRef<HTMLButtonElement>(null)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)

  // The photo changed (e.g. turned): its new thumbnail.
  const version = useRef(rec.modifiedTime)
  useEffect(() => {
    mounted.current = true
    let current = url
    if (version.current !== rec.modifiedTime) {
      version.current = rec.modifiedTime
      current = cachedThumbUrl(rec.id)
      setUrl(current)
      setDrawn(false)
    }
    if (current) return
    loadThumb(rec, () => mounted.current, () => screenOrder(el.current)).then((u) => {
      if (mounted.current) setUrl(u)
    })
    return () => {
      mounted.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.id, rec.modifiedTime])

  const startPress = () => {
    if (!onLongPress || selected !== undefined) return
    const state = { fired: false, timer: setTimeout(() => {
      state.fired = true
      onLongPress(rec.id)
    }, LONG_PRESS_MS) }
    press.current = state
  }
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer)
  }

  return (
    <button
      type="button"
      ref={el}
      className={`cell ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={(e) => {
        if (press.current?.fired) {
          press.current = null
          return
        }
        if ((e.ctrlKey || e.metaKey) && selected === undefined && onLongPress) return onLongPress(rec.id)
        onOpen(rec.id, e)
      }}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onContextMenu={(e) => selected === undefined && onLongPress && e.preventDefault()}
      title={rec.name}
    >
      {url ? (
        <img
          key={tries}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setDrawn(true)}
          onError={() => {
            // Not drawn: loaded again a little later (the spinner turns meanwhile), then the name shows.
            if (tries >= RETRY_MS.length) return setUrl(null)
            setDrawn(false)
            setTimeout(() => {
              if (!mounted.current) return
              const last = tries === RETRY_MS.length - 1
              void reloadThumb(rec, () => mounted.current, () => screenOrder(el.current), last).then((u) => {
                if (!mounted.current) return
                setUrl(u)
                setTries(tries + 1)
              })
            }, RETRY_MS[tries])
          }}
        />
      ) : url === null ? (
        <span className="fallback">
          <bdi>{rec.name}</bdi>
        </span>
      ) : null}
      {url !== null && !drawn && (
        <span className="cell-loading" aria-hidden="true">
          <Loader2 size={20} className="spin" />
        </span>
      )}
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
          onPointerDown={(e) => e.stopPropagation()}
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
