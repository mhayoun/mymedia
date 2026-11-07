// "What takes up space": categories and albums sorted by size, from the sizes known locally.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { Modal } from './Dialog'
import { UNFILED, type FolderInfo, type Library } from './useLibrary'

interface Props {
  lib: Library
  onClose: () => void
}

const bySize = (list: FolderInfo[]) => [...list].sort((a, b) => b.size - a.size)

/** "42 %", or "<1 %" for a small but not empty part; kept left-to-right in Hebrew too. */
function Share({ part, total }: { part: number; total: number }) {
  const n = total ? (part / total) * 100 : 0
  return (
    <bdi className="share" dir="ltr">
      {part > 0 && n < 1 ? '<1' : Math.round(n)} %
    </bdi>
  )
}

export function StorageDialog({ lib, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)
  const setFilters = useApp((s) => s.setFilters)
  const set = useApp((s) => s.set)
  const [opened, setOpened] = useState<Set<string>>(new Set())

  const { total, categories, unfiled } = useMemo(() => {
    const total = lib.items.reduce((n, i) => n + (i.rec.size || 0), 0)
    const atRoot = lib.items.filter((i) => i.rec.folderId === rootId)
    const unfiled = {
      size: atRoot.reduce((n, i) => n + (i.rec.size || 0), 0),
      count: atRoot.length,
    }
    return { total, categories: bySize(lib.categories), unfiled }
  }, [lib, rootId])

  const go = (categoryId: string, albumId: string | null) => {
    setFilters({ categoryId, albumId, personId: null, provenance: null })
    set({ sidebarOpen: false })
    onClose()
  }
  const toggle = (id: string) => {
    const next = new Set(opened)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOpened(next)
  }

  const row = (f: FolderInfo, categoryId: string, depth: number) => {
    const share = total ? f.size / total : 0
    const isOpen = opened.has(f.id)
    return (
      <li key={f.id}>
        <div className="storage-row" style={{ paddingInlineStart: depth * 18 }}>
          {f.children.length > 0 ? (
            <button className="icon-btn small" onClick={() => toggle(f.id)} aria-expanded={isOpen} aria-label={f.name}>
              {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} className="flip-rtl" />}
            </button>
          ) : (
            <span className="storage-spacer" />
          )}
          <button className="storage-main" onClick={() => go(categoryId, depth === 0 ? null : f.id)}>
            <span className="storage-line">
              <bdi className="name">{f.name}</bdi>
              <span className="size">{fmt.bytes(f.size)}</span>
              <Share part={f.size} total={total} />
            </span>
            <span className="bar">
              <span style={{ inlineSize: `${Math.max(share * 100, f.size ? 1 : 0)}%` }} />
            </span>
            <span className="detail">
              {t('storage.files', { count: f.count, files: fmt.number(f.count) })}
              {f.videoCount > 0 && <> · {t('storage.videos', { count: f.videoCount, videos: fmt.number(f.videoCount), size: fmt.bytes(f.videoSize) })}</>}
            </span>
          </button>
        </div>
        {isOpen && f.children.length > 0 && <ul>{bySize(f.children).map((c) => row(c, categoryId, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <Modal title={t('storage.whatTitle', { size: fmt.bytes(total) })} onClose={onClose} closeButton>
      <p className="hint">{t('storage.whatHint')}</p>
      <ul className="storage-list">
        {categories.map((c) => row(c, c.id, 0))}
        {unfiled.count > 0 && (
          <li>
            <div className="storage-row">
              <span className="storage-spacer" />
              <button className="storage-main" onClick={() => go(UNFILED, null)}>
                <span className="storage-line">
                  <span className="name">{t('nav.unfiled')}</span>
                  <span className="size">{fmt.bytes(unfiled.size)}</span>
                  <Share part={unfiled.size} total={total} />
                </span>
                <span className="bar">
                  <span style={{ inlineSize: `${total ? (unfiled.size / total) * 100 : 0}%` }} />
                </span>
                <span className="detail">{t('storage.files', { count: unfiled.count, files: fmt.number(unfiled.count) })}</span>
              </button>
            </div>
          </li>
        )}
      </ul>
    </Modal>
  )
}
