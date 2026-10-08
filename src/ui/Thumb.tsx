import { Check, Play } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { cachedThumbUrl, loadThumb } from '../sync/thumbs'

interface Props {
  rec: MediaRecord
  onOpen: (id: string, e: { shiftKey: boolean }) => void
  /** Selection mode: true/false; undefined when not selecting. */
  selected?: boolean
  /** Long press (touch) or Ctrl/⌘-click: start selecting with this media. */
  onLongPress?: (id: string) => void
}

const LONG_PRESS_MS = 500

export const Thumb = memo(function Thumb({ rec, onOpen, selected, onLongPress }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const bySize = useApp((s) => s.settings.sort === 'largest' || s.settings.sort === 'smallest')
  const [url, setUrl] = useState<string | null | undefined>(() => cachedThumbUrl(rec.id))
  const mounted = useRef(true)
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null)

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
    </button>
  )
})
