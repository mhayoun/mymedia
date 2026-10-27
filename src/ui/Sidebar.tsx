import { CalendarDays, ChevronDown, ChevronRight, CircleHelp, Cloud, Download, Eye, Folder, FolderOpen, Gauge, Images, Inbox, MessagesSquare, MonitorDown, Plus, ScrollText, Share2, Sparkles, Upload, Users, Wand2, Store } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { storageQuota, type DriveQuota } from '../drive/api'
import { LOCALES } from '../i18n'
import { useFormat } from '../i18n/format'
import { buildPeriods, periodLabel } from '../lib/periods'
import { useApp } from '../store'
import { FaceImg } from './FaceImg'
import { Modal } from './Dialog'
import { canPromptInstall, installHow, isInstalled, promptInstall, subscribeInstall } from '../lib/install'
import type { ProvenanceEntry } from '../lib/provenance'
import { AUTO, filterItems, PEOPLE, TO_CLASSIFY, UNFILED, type FolderInfo, type Library } from './useLibrary'
import type { People } from './usePeople'
import { useProvenanceLabel } from './useProvenanceLabel'

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
  const readOnly = useApp((s) => s.readOnly)
  const shared = useApp((s) => s.shared)
  // The chosen category or album, clicked again, closes (or opens again) its sub-albums.
  const [closedId, setClosed] = useState<string | null>(null)
  // Only while it is still the chosen one (a new album opened elsewhere shows its category open).
  const closed = closedId === (filters.albumId ?? filters.categoryId) ? closedId : null
  const select = (categoryId: string | null, albumId: string | null, hasChildren = false) => {
    const id = albumId ?? categoryId
    const current = filters.albumId ?? filters.categoryId
    if (hasChildren && id === current) {
      setClosed(closed === id ? null : id)
      return
    }
    setClosed(null)
    setFilters({ categoryId, albumId, personId: null, provenance: null })
    // A folder with sub-folders: the menu stays open (on a phone) to choose one of them.
    if (!hasChildren) set({ sidebarOpen: false })
  }
  const total = lib.items.length
  const [categoriesOpen, toggleCategories] = useFolded('categories')
  const [peopleOpen, togglePeople] = useFolded('people')

  return (
    <>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => set({ sidebarOpen: false })} />
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label={t('nav.categories')}>
        <div className="nav-row">
          <button className="nav-item" aria-current={!filters.categoryId && !filters.personId && !filters.provenance} onClick={() => select(null, null)}>
            <Images size={18} />
            <span className="label">{t('nav.allMedia')}</span>
            <span className="count">{total}</span>
          </button>
          <FoldButton open={categoriesOpen} label={t('nav.categories')} onClick={toggleCategories} />
        </div>
        {lib.toClassify.length > 0 && !readOnly && (
          <button className="nav-item" aria-current={filters.categoryId === TO_CLASSIFY} onClick={() => select(TO_CLASSIFY, null)}>
            <Wand2 size={18} />
            <span className="label">{t('classify.toClassify')}</span>
            <span className="count">{lib.toClassify.length}</span>
          </button>
        )}
        {lib.autoItems.length > 0 && !readOnly && (
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
        {categoriesOpen && <>
        <h2>{t('nav.categories')}</h2>
        {lib.categories.map((c) => (
          <div key={c.id}>
            <button
              className="nav-item"
              aria-current={filters.categoryId === c.id && !filters.albumId}
              onClick={() => select(c.id, null, c.children.length > 0)}
            >
              {filters.categoryId === c.id ? <FolderOpen size={18} /> : <Folder size={18} />}
              <span className="label">
                <bdi>{c.name}</bdi>
              </span>
              <span className="count">{c.count}</span>
            </button>
            {filters.categoryId === c.id && closed !== c.id && c.children.length > 0 && (
              <div className="nav-children">
                <AlbumList folders={c.children} categoryId={c.id} activeId={filters.albumId} closed={closed} onSelect={select} />
              </div>
            )}
          </div>
        ))}
        {!readOnly && (
          <button className="nav-item" onClick={onNewCategory}>
            <Plus size={18} />
            <span className="label">{t('nav.newCategory')}</span>
          </button>
        )}
        </>}
        {facesEnabled && (!readOnly || people.named.length > 0) && (
          <>
            {/* Read-only: the people the owner named, nothing to sort out (the arrow is on the title). */}
            {readOnly ? (
              <div className="nav-row">
                <h2>{t('faces.people')}</h2>
                <FoldButton open={peopleOpen} label={t('faces.people')} onClick={togglePeople} />
              </div>
            ) : (
              <h2>{t('faces.people')}</h2>
            )}
            {!readOnly && <div className="nav-row">
              <button className="nav-item" aria-current={filters.categoryId === PEOPLE} onClick={() => select(PEOPLE, null)}>
                <Users size={18} />
                <span className="label">{t('faces.allPeople')}</span>
                {people.toConfirm.length + people.unnamed.length > 0 && (
                  <span className="count">{t('faces.toReview', { count: people.toConfirm.length + people.unnamed.length })}</span>
                )}
              </button>
              {people.named.length > 0 && <FoldButton open={peopleOpen} label={t('faces.people')} onClick={togglePeople} />}
            </div>}
            {peopleOpen && people.named.map((p) => (
              <button
                key={p.id}
                className="nav-item"
                aria-current={filters.personId === p.id}
                onClick={() => {
                  setFilters({ personId: p.id, categoryId: null, albumId: null, provenance: null })
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
        <DatesList lib={lib} />
        <ProvenanceList lib={lib} />
        <h2 />
        {!shared && (
          <button className="nav-item" onClick={() => set({ shareOpen: 'share', sidebarOpen: false })}>
            <Share2 size={18} />
            <span className="label">{t('share.menu')}</span>
          </button>
        )}
        <button className="nav-item" onClick={() => set({ shareOpen: 'view', sidebarOpen: false })}>
          <Eye size={18} />
          <span className="label">{t('share.viewMenu')}</span>
        </button>
        {!readOnly && (
          <>
            <button className="nav-item" onClick={() => set({ shopOpen: true, sidebarOpen: false })}>
              <Store size={18} />
              <span className="label">{t('models.inUse')}</span>
            </button>
            <button className="nav-item" onClick={() => set({ shopOpen: 'publish', sidebarOpen: false })}>
              <Upload size={18} />
              <span className="label">{t('models.openPublish')}</span>
            </button>
          </>
        )}
        <InstallItem />
        <button
          className="nav-item"
          onClick={() => set({ helpOpen: true, sidebarOpen: false })}
        >
          <CircleHelp size={18} />
          <span className="label">{t('nav.help')}</span>
        </button>
        <button className="nav-item" onClick={() => set({ speedOpen: true, sidebarOpen: false })}>
          <Gauge size={18} />
          <span className="label">{t('speed.menu')}</span>
        </button>
        <button className="nav-item" onClick={() => set({ activityOpen: true, sidebarOpen: false })}>
          <ScrollText size={18} />
          <span className="label">{t('activity.title')}</span>
        </button>
        {!readOnly && <DriveStorage lib={lib} />}
        <div className="app-version">MyMedia · {t('settings.version', { version: __APP_VERSION__ })}</div>
      </nav>
    </>
  )
}

/** A list of the menu shown or folded (like Provenance's sections), remembered on this device. */
function useFolded(name: string): [boolean, () => void] {
  const key = `mymedia.menuFolded.${name}`
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '1'
    } catch {
      return true
    }
  })
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(key, open ? '1' : '0')
    } catch {
      // Not remembered: still folded for this session.
    }
  }
  return [open, toggle]
}

function FoldButton({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return (
    <button className="nav-fold" aria-expanded={open} aria-label={label} title={label} onClick={onClick}>
      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} className="flip-rtl" />}
    </button>
  )
}

/**
 * Years (and their months) of the media shown, by date taken. The period
 * chosen narrows the category, album or person open (shown as a filter chip).
 */
function DatesList({ lib }: { lib: Library }) {
  const { t, i18n } = useTranslation()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const rootId = useApp((s) => s.rootId)
  const set = useApp((s) => s.set)
  const [listOpen, toggle] = useFolded('dates')
  const [openYear, setOpenYear] = useState<string | null>(null)
  const { period, ...place } = filters
  const years = useMemo(
    () => (rootId ? buildPeriods(filterItems(lib, { ...place, period: null }, rootId).map((i) => i.rec.takenAt)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lib, rootId, JSON.stringify(place)],
  )
  if (!years.length) return null
  const locale = LOCALES[i18n.language as keyof typeof LOCALES] ?? 'en-US'
  // Clicked again: the period is no longer chosen.
  const choose = (p: string) => {
    setFilters({ period: period === p ? null : p })
    set({ sidebarOpen: false })
  }
  return (
    <>
      <div className="nav-row">
        <h2>{t('dates.title')}</h2>
        <FoldButton open={listOpen} label={t('dates.title')} onClick={toggle} />
      </div>
      {listOpen &&
        years.map((y) => {
          const shown = openYear === y.year || !!period?.startsWith(`${y.year}-`)
          return (
            <div key={y.year}>
              <div className="nav-row">
                <button className="nav-item" aria-current={period === y.year} onClick={() => choose(y.year)}>
                  <CalendarDays size={18} />
                  <span className="label">{y.year}</span>
                  <span className="count">{y.count}</span>
                </button>
                <FoldButton open={shown} label={y.year} onClick={() => setOpenYear(shown ? null : y.year)} />
              </div>
              {shown && (
                <div className="nav-children">
                  {y.months.map((m) => (
                    <button key={m.key} className="nav-item" aria-current={period === m.key} onClick={() => choose(m.key)}>
                      <span className="label">{periodLabel(m.key, locale)}</span>
                      <span className="count">{m.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
    </>
  )
}

/** Where media came from: Facebook groups and imports (folder or ZIP, day). */
function ProvenanceList({ lib }: { lib: Library }) {
  const { t } = useTranslation()
  const { label } = useProvenanceLabel()
  const active = useApp((s) => s.filters.provenance)
  const setFilters = useApp((s) => s.setFilters)
  const set = useApp((s) => s.set)
  const { groups, imports } = lib.provenance
  if (!groups.length && !imports.length) return null

  const select = (key: string) => {
    setFilters({ provenance: key, categoryId: null, albumId: null, personId: null })
    set({ sidebarOpen: false })
  }
  return (
    <>
      <h2>{t('provenance.title')}</h2>
      {groups.length > 0 && (
        <Section icon={<MessagesSquare size={18} />} title={t('provenance.groups')} entries={groups} active={active} label={label} onSelect={select} />
      )}
      {imports.length > 0 && (
        <Section icon={<Download size={18} />} title={t('provenance.imports')} entries={imports} active={active} label={label} onSelect={select} />
      )}
    </>
  )
}

function Section({
  icon,
  title,
  entries,
  active,
  label,
  onSelect,
}: {
  icon: ReactNode
  title: string
  entries: ProvenanceEntry[]
  active: string | null | undefined
  label: (e: ProvenanceEntry) => string
  onSelect: (key: string) => void
}) {
  const hasActive = entries.some((e) => e.key === active)
  const [open, setOpen] = useState(hasActive)
  const shown = open || hasActive
  return (
    <div>
      <button className="nav-item" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        {icon}
        <span className="label">{title}</span>
        <span className="count">{entries.length}</span>
        {shown ? <ChevronDown size={16} /> : <ChevronRight size={16} className="flip-rtl" />}
      </button>
      {shown && (
        <div className="nav-children">
          {entries.map((e) => (
            <button key={e.key} className="nav-item" aria-current={active === e.key} onClick={() => onSelect(e.key)}>
              <span className="label">
                <bdi>{label(e)}</bdi>
              </span>
              <span className="count">{e.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Google Drive space: used / free for the whole account, and what MyMedia takes. */
function DriveStorage({ lib }: { lib: Library }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [quota, setQuota] = useState<DriveQuota | null>(null)
  const count = lib.items.length
  const mine = lib.items.reduce((n, i) => n + i.rec.size, 0)

  useEffect(() => {
    let alive = true
    storageQuota()
      .then((q) => alive && setQuota(q))
      .catch(() => {}) // offline: keep the last value
    return () => {
      alive = false
    }
  }, [count])

  if (!quota) return null
  const ratio = quota.limit ? Math.min(1, quota.usage / quota.limit) : 0
  return (
    <div className="storage">
      <span className="title">
        <Cloud size={16} /> {t('storage.title')}
      </span>
      {quota.limit !== undefined && (
        <div className={`bar ${ratio > 0.9 ? 'full' : ''}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ inlineSize: `${ratio * 100}%` }} />
        </div>
      )}
      <span>
        {quota.limit !== undefined
          ? t('storage.used', { used: fmt.bytes(quota.usage), total: fmt.bytes(quota.limit) })
          : t('storage.usedUnlimited', { used: fmt.bytes(quota.usage) })}
      </span>
      {quota.limit !== undefined && <span>{t('storage.free', { free: fmt.bytes(Math.max(0, quota.limit - quota.usage)) })}</span>}
      <span>{t('storage.mine', { size: fmt.bytes(mine) })}</span>
    </div>
  )
}

function AlbumList({
  folders,
  categoryId,
  activeId,
  closed,
  onSelect,
}: {
  folders: FolderInfo[]
  categoryId: string
  activeId: string | null
  /** The chosen album, when the user closed it. */
  closed: string | null
  onSelect: (categoryId: string, albumId: string, hasChildren: boolean) => void
}) {
  // Only the albums on the way to the chosen one show their sub-albums.
  const holds = (f: FolderInfo): boolean => f.id === activeId || f.children.some(holds)
  const opened = (f: FolderInfo) => activeId !== null && holds(f) && f.id !== closed
  return (
    <>
      {folders.map((a) => (
        <div key={a.id}>
          <button className="nav-item" aria-current={activeId === a.id} onClick={() => onSelect(categoryId, a.id, a.children.length > 0)}>
            {a.children.length > 0 && (opened(a) ? <ChevronDown size={14} /> : <ChevronRight size={14} className="flip-rtl" />)}
            <span className="label">
              <bdi>{a.name}</bdi>
            </span>
            <span className="count">{a.count}</span>
          </button>
          {a.children.length > 0 && opened(a) && (
            <div className="nav-children">
              <AlbumList folders={a.children} categoryId={categoryId} activeId={activeId} closed={closed} onSelect={onSelect} />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/** "Install the app" (not shown once it runs as an app): the browser's window, or how to do it. */
function InstallItem() {
  const { t } = useTranslation()
  const set = useApp((s) => s.set)
  useSyncExternalStore(subscribeInstall, canPromptInstall)
  const [help, setHelp] = useState(false)
  if (isInstalled()) return null
  return (
    <>
      <button
        className="nav-item"
        onClick={async () => {
          if (await promptInstall()) set({ sidebarOpen: false })
          else setHelp(true)
        }}
      >
        <MonitorDown size={18} />
        <span className="label">{t('install.menu')}</span>
      </button>
      {/* Outside the menu: on phones it is moved (transform), which would confine the window to its width. */}
      {help && createPortal(
        <Modal title={t('install.title')} onClose={() => setHelp(false)}>
          <p>{t(`install.${installHow()}`)}</p>
          <div className="actions">
            <button className="btn primary" onClick={() => setHelp(false)}>
              {t('common.ok')}
            </button>
          </div>
        </Modal>,
        document.body,
      )}
    </>
  )
}
