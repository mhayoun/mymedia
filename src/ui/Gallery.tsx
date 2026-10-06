import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ALBUM_SEPARATOR } from '../lib/tree'
import { useApp } from '../store'
import { Thumb } from './Thumb'
import { groupByAlbum, type LibraryItem } from './useLibrary'
import { Viewer } from './Viewer'

type Row =
  | { kind: 'header'; key: string; parts: string[]; count: number }
  | { kind: 'cells'; key: string; items: LibraryItem[] }

const GAP = 3
const HEADER_H = 44

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

export function Gallery({ items }: { items: LibraryItem[] }) {
  const { t } = useTranslation()
  const view = useApp((s) => s.settings.view)
  const viewerId = useApp((s) => s.viewerId)
  const set = useApp((s) => s.set)
  const scrollRef = useRef<HTMLDivElement>(null)
  const width = useWidth(scrollRef)

  const target = width < 500 ? 110 : width < 900 ? 150 : 190
  const cols = Math.max(3, Math.floor(width / target)) || 3
  const cell = width ? (width - GAP * (cols + 1)) / cols : 120

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const chunk = (list: LibraryItem[], prefix: string) => {
      for (let i = 0; i < list.length; i += cols) {
        out.push({ kind: 'cells', key: `${prefix}:${i}`, items: list.slice(i, i + cols) })
      }
    }
    if (view === 'albums') {
      for (const g of groupByAlbum(items)) {
        // Each name is isolated so Hebrew and Latin names keep their own direction.
        const parts = [g.category, ...(g.album?.split(ALBUM_SEPARATOR) ?? [])].filter((p): p is string => !!p)
        out.push({ kind: 'header', key: `h:${g.key}`, parts: parts.length ? parts : [t('nav.unfiled')], count: g.items.length })
        chunk(g.items, g.key)
      }
    } else chunk(items, 'all')
    return out
  }, [items, cols, view, t])

  const orderedIds = useMemo(
    () => rows.flatMap((r) => (r.kind === 'cells' ? r.items.map((i) => i.rec.id) : [])),
    [rows],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].kind === 'header' ? HEADER_H : cell + GAP),
    overscan: 4,
    getItemKey: (i) => rows[i].key,
  })

  useEffect(() => {
    virtualizer.measure()
  }, [cell, rows, virtualizer])

  const selection = useApp((s) => s.selection)
  const selected = useMemo(() => (selection ? new Set(selection) : null), [selection])
  const lastPicked = useRef<string | null>(null)
  const open = useCallback(
    (id: string, e: { shiftKey: boolean }) => {
      const current = useApp.getState().selection
      if (!current) return set({ viewerId: id })
      const next = new Set(current)
      if (e.shiftKey && lastPicked.current) {
        // Shift-click: everything between the last picked media and this one.
        const a = orderedIds.indexOf(lastPicked.current)
        const b = orderedIds.indexOf(id)
        for (const x of orderedIds.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      lastPicked.current = id
      set({ selection: [...next] })
    },
    [set, orderedIds],
  )
  const startSelection = useCallback(
    (id: string) => {
      lastPicked.current = id
      set({ selection: [id] })
    },
    [set],
  )

  return (
    <>
      <div className="gallery-scroll" ref={scrollRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]
            if (row.kind === 'header') {
              return (
                <div key={v.key} className="group-header" style={{ top: v.start, height: HEADER_H }}>
                  <span>
                    {row.parts.map((p, i) => (
                      <span key={i}>
                        {i > 0 && ' / '}
                        <bdi>{p}</bdi>
                      </span>
                    ))}
                  </span>
                  <span className="count">{t('gallery.count', { count: row.count })}</span>
                </div>
              )
            }
            return (
              <div
                key={v.key}
                className="gallery-row"
                style={{ top: v.start + GAP, gridTemplateColumns: `repeat(${cols}, ${cell}px)` }}
              >
                {row.items.map((it) => (
                  <Thumb key={it.rec.id} rec={it.rec} onOpen={open} selected={selected ? selected.has(it.rec.id) : undefined} onLongPress={startSelection} />
                ))}
              </div>
            )
          })}
        </div>
      </div>
      {viewerId && <Viewer ids={orderedIds} items={items} />}
    </>
  )
}
