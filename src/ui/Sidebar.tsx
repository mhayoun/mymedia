import { Folder, FolderOpen, Images, Inbox, Plus, Sparkles, Users, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { FaceImg } from './FaceImg'
import { AUTO, PEOPLE, TO_CLASSIFY, UNFILED, type FolderInfo, type Library } from './useLibrary'
import type { People } from './usePeople'

interface Props {
  lib: Library
  people: People
  onNewCategory: () => void
}

export function Sidebar({ lib, people, onNewCategory }: Props) {
  const { t } = useTranslation()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const open = useApp((s) => s.sidebarOpen)
  const set = useApp((s) => s.set)

  const facesEnabled = useApp((s) => s.settings.facesEnabled)
  const select = (categoryId: string | null, albumId: string | null) => {
    setFilters({ categoryId, albumId, personId: null })
    set({ sidebarOpen: false })
  }
  const total = lib.items.length

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => set({ sidebarOpen: false })} />
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label={t('nav.categories')}>
        <button className="nav-item" aria-current={!filters.categoryId && !filters.personId} onClick={() => select(null, null)}>
          <Images size={18} />
          <span className="label">{t('nav.allMedia')}</span>
          <span className="count">{total}</span>
        </button>
        {lib.toClassify.length > 0 && (
          <button className="nav-item" aria-current={filters.categoryId === TO_CLASSIFY} onClick={() => select(TO_CLASSIFY, null)}>
            <Wand2 size={18} />
            <span className="label">{t('classify.toClassify')}</span>
            <span className="count">{lib.toClassify.length}</span>
          </button>
        )}
        {lib.autoItems.length > 0 && (
          <button className="nav-item" aria-current={filters.categoryId === AUTO} onClick={() => select(AUTO, null)}>
            <Sparkles size={18} />
            <span className="label">{t('classify.autoView')}</span>
            <span className="count">{lib.autoItems.length}</span>
          </button>
        )}
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
        {facesEnabled && (
          <>
            <h2>{t('faces.people')}</h2>
            <button className="nav-item" aria-current={filters.categoryId === PEOPLE} onClick={() => select(PEOPLE, null)}>
              <Users size={18} />
              <span className="label">{t('faces.allPeople')}</span>
              {people.toConfirm.length + people.unnamed.length > 0 && (
                <span className="count">{t('faces.toReview', { count: people.toConfirm.length + people.unnamed.length })}</span>
              )}
            </button>
            {people.named.map((p) => (
              <button
                key={p.id}
                className="nav-item"
                aria-current={filters.personId === p.id}
                onClick={() => {
                  setFilters({ personId: p.id, categoryId: null, albumId: null })
                  set({ sidebarOpen: false })
                }}
              >
                <FaceImg face={p.cover} size={22} />
                <span className="label">
                  <bdi>{p.name}</bdi>
                </span>
                <span className="count">{p.mediaIds.size}</span>
              </button>
            ))}
          </>
        )}
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
