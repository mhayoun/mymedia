import { Folder, FolderOpen, Images, Inbox, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { UNFILED, type FolderInfo, type Library } from './useLibrary'

interface Props {
  lib: Library
  onNewCategory: () => void
}

export function Sidebar({ lib, onNewCategory }: Props) {
  const { t } = useTranslation()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const open = useApp((s) => s.sidebarOpen)
  const set = useApp((s) => s.set)

  const select = (categoryId: string | null, albumId: string | null) => {
    setFilters({ categoryId, albumId })
    set({ sidebarOpen: false })
  }
  const total = lib.items.length

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => set({ sidebarOpen: false })} />
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label={t('nav.categories')}>
        <button className="nav-item" aria-current={!filters.categoryId} onClick={() => select(null, null)}>
          <Images size={18} />
          <span className="label">{t('nav.allMedia')}</span>
          <span className="count">{total}</span>
        </button>
        {lib.unfiledCount > 0 && (
          <button className="nav-item" aria-current={filters.categoryId === UNFILED} onClick={() => select(UNFILED, null)}>
            <Inbox size={18} />
            <span className="label">{t('nav.unfiled')}</span>
            <span className="count">{lib.unfiledCount}</span>
          </button>
        )}
        <h2>{t('nav.categories')}</h2>
        {lib.categories.map((c) => (
          <div key={c.id}>
            <button
              className="nav-item"
              aria-current={filters.categoryId === c.id && !filters.albumId}
              onClick={() => select(c.id, null)}
            >
              {filters.categoryId === c.id ? <FolderOpen size={18} /> : <Folder size={18} />}
              <span className="label">
                <bdi>{c.name}</bdi>
              </span>
              <span className="count">{c.count}</span>
            </button>
            {filters.categoryId === c.id && c.children.length > 0 && (
              <div className="nav-children">
                <AlbumList folders={c.children} categoryId={c.id} activeId={filters.albumId} onSelect={select} />
              </div>
            )}
          </div>
        ))}
        <button className="nav-item" onClick={onNewCategory}>
          <Plus size={18} />
          <span className="label">{t('nav.newCategory')}</span>
        </button>
      </nav>
    </>
  )
}

function AlbumList({
  folders,
  categoryId,
  activeId,
  onSelect,
}: {
  folders: FolderInfo[]
  categoryId: string
  activeId: string | null
  onSelect: (categoryId: string, albumId: string) => void
}) {
  return (
    <>
      {folders.map((a) => (
        <div key={a.id}>
          <button className="nav-item" aria-current={activeId === a.id} onClick={() => onSelect(categoryId, a.id)}>
            <span className="label">
              <bdi>{a.name}</bdi>
            </span>
            <span className="count">{a.count}</span>
          </button>
          {a.children.length > 0 && (
            <div className="nav-children">
              <AlbumList folders={a.children} categoryId={categoryId} activeId={activeId} onSelect={onSelect} />
            </div>
          )}
        </div>
      ))}
    </>
  )
}
