import { Brain, FolderPlus, ImagePlus, LayoutGrid, Minimize2, Pause, Menu, Pencil, RefreshCw, Rows3, Settings as SettingsIcon, Trash2, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { useFormat } from '../i18n/format'
import { app, useApp } from '../store'
import { createAlbum, createCategory, deleteFolder, renameFolder } from '../sync/folders'
import { cancelCompression } from '../compress/engine'
import { subtreeIds } from '../lib/tree'
import { stopIndexer } from '../ml/indexer'
import { cancelSync, syncNow } from '../sync/engine'
import { CompressDialog } from './CompressDialog'
import { ConfirmDialog, PromptDialog } from './Dialog'
import { ImportDialog } from './ImportDialog'
import { Gallery } from './Gallery'
import { useAuthError, useAuthStatus, useAutoSync, useOnline } from './hooks'
import { SettingsPanel } from './SettingsPanel'
import { Sidebar } from './Sidebar'
import { LibraryContext } from './libraryContext'
import { ReviewView } from './ReviewView'
import { StatsDialog } from './StatsDialog'
import { AUTO, filterItems, PEOPLE, sortItems, TO_CLASSIFY, UNFILED, useLibrary, type Library } from './useLibrary'
import { clearSharedFiles, hasSharedFiles, readSharedFiles } from '../import/shared'
import { FacesIntro } from './FacesIntro'
import { FilterBar } from './FilterBar'
import { SelectionBar } from './SelectionBar'
import { PeopleContext, PersonDialogContext } from './peopleContext'
import { PeopleView } from './PeopleView'
import { PersonDialog } from './PersonDialog'
import { usePeople, type People } from './usePeople'

type DialogState =
  | { kind: 'newCategory' }
  | { kind: 'newAlbum'; parentId: string; parentName: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete'; id: string; name: string; count: number }
  | { kind: 'compress'; title: string; folderId: string | null }
  | { kind: 'import'; destId: string; files?: File[] }
  | null

export function Shell() {
  const { t } = useTranslation()
  const lib = useLibrary()
  const rootId = useApp((s) => s.rootId)
  const filters = useApp((s) => s.filters)
  const sort = useApp((s) => s.settings.sort)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const statsOpen = useApp((s) => s.statsOpen)
  const compressOffer = useApp((s) => s.compressOffer)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [personOpen, setPersonOpen] = useState<string | null>(null)
  const selection = useApp((s) => s.selection)
  const people = usePeople()
  useAutoSync()

  // Files shared to MyMedia from another app (Android Share menu).
  useEffect(() => {
    if (!rootId || !hasSharedFiles()) return
    readSharedFiles().then((files) => {
      if (files.length) setDialog({ kind: 'import', destId: rootId, files })
      else void clearSharedFiles()
    })
  }, [rootId])

  const personMedia = filters.personId ? people.byId.get(filters.personId)?.mediaIds : undefined
  // Folder shown (album or category), used by Add and Compress in the top bar.
  const specialView = [UNFILED, TO_CLASSIFY, AUTO, PEOPLE].includes(filters.categoryId ?? '') || !!filters.personId
  const currentFolderId = filters.albumId ?? (!specialView && filters.categoryId && lib.folders.has(filters.categoryId) ? filters.categoryId : null)
  const currentTitle = currentFolderId
    ? (lib.folders.get(currentFolderId)?.name ?? '')
    : filters.personId
      ? (people.byId.get(filters.personId)?.name ?? t('faces.unnamed'))
      : t('nav.allMedia')
  const items = useMemo(
    () => (rootId ? sortItems(filterItems(lib, filters, rootId, personMedia ?? new Set()), sort) : []),
    [lib, filters, rootId, sort, personMedia],
  )

  const siblingsHaveName = (parentId: string, name: string, exceptId?: string) =>
    [...lib.folders.values()].some(
      (f) => f.parentId === parentId && f.id !== exceptId && f.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
    )

  return (
    <LibraryContext.Provider value={lib}>
    <PeopleContext.Provider value={people}>
    <PersonDialogContext.Provider value={setPersonOpen}>
    <div className={`shell ${selection ? 'selecting' : ''}`}>
      <TopBar />
      <Banners />
      <div className="body">
        <Sidebar lib={lib} people={people} onNewCategory={() => setDialog({ kind: 'newCategory' })} />
        <main className="main">
          <Toolbar
            lib={lib}
            people={people}
            count={items.length}
            onDialog={setDialog}
            onAdd={() => setDialog({ kind: 'import', destId: currentFolderId ?? rootId! })}
            onCompress={() => setDialog({ kind: 'compress', title: t('compress.titleFor', { name: currentTitle }), folderId: currentFolderId })}
          />
          {filters.categoryId !== PEOPLE && <FilterBar people={people} lib={lib} />}
          {filters.categoryId === PEOPLE ? (
            <PeopleView people={people} />
          ) : lib.ready && items.length === 0 ? (
            <EmptyState />
          ) : filters.categoryId === TO_CLASSIFY || filters.categoryId === AUTO ? (
            <ReviewView lib={lib} items={items} mode={filters.categoryId === AUTO ? 'auto' : 'classify'} />
          ) : (
            <Gallery items={items} />
          )}
        </main>
      </div>
      {settingsOpen && <SettingsPanel />}
      {statsOpen && <StatsDialog lib={lib} />}
      {compressOffer && (
        <CompressDialog mode="offer" title={t('compress.offerTitle')} planned={compressOffer} onClose={() => useApp.getState().set({ compressOffer: null })} />
      )}
      <Toast />

      {dialog?.kind === 'newCategory' && rootId && (
        <PromptDialog
          title={t('folders.newCategoryTitle')}
          confirmLabel={t('common.create')}
          validate={(v) => (siblingsHaveName(rootId, v) ? t('folders.exists') : null)}
          onSubmit={createCategory}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'newAlbum' && (
        <PromptDialog
          title={t('folders.newAlbumTitle', { parent: dialog.parentName })}
          confirmLabel={t('common.create')}
          validate={(v) => (siblingsHaveName(dialog.parentId, v) ? t('folders.exists') : null)}
          onSubmit={(v) => createAlbum(v, dialog.parentId)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title={t('folders.renameTitle', { name: dialog.name })}
          initial={dialog.name}
          validate={(v) => {
            const parent = lib.folders.get(dialog.id)?.parentId
            return parent && siblingsHaveName(parent, v, dialog.id) ? t('folders.exists') : null
          }}
          onSubmit={(v) => renameFolder(dialog.id, v)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'compress' && (
        <CompressDialog
          mode="manual"
          title={dialog.title}
          items={(dialog.folderId
            ? (() => {
                const ids = subtreeIds(dialog.folderId, lib.folders.values())
                return lib.items.filter((i) => ids.has(i.rec.folderId))
              })()
            : items
          ).map((i) => i.rec)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          lib={lib}
          destId={dialog.destId}
          initialFiles={dialog.files}
          onClose={() => {
            if (dialog.files) void clearSharedFiles()
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('folders.deleteTitle', { name: dialog.name })}
          text={t('folders.deleteText', { count: dialog.count })}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={() => deleteFolder(dialog.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {filters.categoryId !== PEOPLE && rootId && (
        <SelectionBar lib={lib} people={people} items={items} parentId={filters.albumId ?? (filters.categoryId && lib.folders.has(filters.categoryId) ? filters.categoryId : rootId)} />
      )}
      {personOpen && <PersonDialog people={people} personId={personOpen} onClose={() => setPersonOpen(null)} />}
      <FacesIntro people={people} />
    </div>
    </PersonDialogContext.Provider>
    </PeopleContext.Provider>
    </LibraryContext.Provider>
  )
}

function TopBar() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const user = useApp((s) => s.user)
  const sync = useApp((s) => s.sync)
  const lastSyncAt = useApp((s) => s.lastSyncAt)
  const indexing = useApp((s) => s.indexing)
  const compressing = useApp((s) => s.compressing)
  const set = useApp((s) => s.set)
  const online = useOnline()

  return (
    <header className="topbar">
      <button className="icon-btn only-mobile" onClick={() => set({ sidebarOpen: true })} aria-label={t('nav.menu')}>
        <Menu />
      </button>
      <div className="title">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <span>{t('app.name')}</span>
      </div>
      {!online && (
        <span className="sync-info" title={t('sync.offline')}>
          <WifiOff size={18} />
        </span>
      )}
      {compressing && (
        <>
          <span className="sync-info" aria-live="polite">
            <Minimize2 size={14} />
            <span className="only-desktop"> {t('compress.progress', { done: fmt.number(compressing.done + 1), total: fmt.number(compressing.total) })}</span>
            <span className="only-mobile-inline">{fmt.number(compressing.done + 1)}/{fmt.number(compressing.total)}</span>
          </span>
          <button className="icon-btn small" onClick={cancelCompression} aria-label={t('common.cancel')} title={t('common.cancel')}>
            <X size={16} />
          </button>
        </>
      )}
      {indexing && !sync && !compressing && (
        <>
          <span className="sync-info" aria-live="polite" title={t('classify.learningHint')}>
            <Brain size={14} />
            <span className="only-desktop"> {t('classify.learning', { done: fmt.number(indexing.done), total: fmt.number(indexing.total) })}</span>
            <span className="only-mobile-inline">{fmt.number(indexing.done)}/{fmt.number(indexing.total)}</span>
          </span>
          <button className="icon-btn small" onClick={stopIndexer} aria-label={t('classify.pause')} title={t('classify.pause')}>
            <Pause size={16} />
          </button>
        </>
      )}
      {sync ? (
        <>
          <span className="sync-info" aria-live="polite">
            <RefreshCw size={14} className="spin" />
            <span className="only-desktop"> {t(sync.step, { done: fmt.number(sync.done), total: fmt.number(sync.total) })}</span>
            <span className="only-mobile-inline">{sync.total ? `${fmt.number(sync.done)}/${fmt.number(sync.total)}` : sync.done ? fmt.number(sync.done) : ''}</span>
          </span>
          <button className="icon-btn small" onClick={cancelSync} aria-label={t('sync.cancel')} title={t('sync.cancel')}>
            <X size={18} />
          </button>
        </>
      ) : (
        <>
          <span className="sync-info only-desktop">
            {lastSyncAt ? t('sync.lastSync', { time: fmt.time(lastSyncAt) }) : ''}
          </span>
          <button className="btn" onClick={() => void syncNow()} disabled={!online} title={t('gallery.loadNew')}>
            <RefreshCw size={16} />
            <span className="only-desktop">{t('gallery.loadNew')}</span>
          </button>
        </>
      )}

      <button className="icon-btn" onClick={() => set({ settingsOpen: true })} aria-label={t('nav.settings')}>
        {user?.photo ? <img className="avatar" src={user.photo} alt="" referrerPolicy="no-referrer" /> : <SettingsIcon />}
      </button>
    </header>
  )
}

function Banners() {
  const { t } = useTranslation()
  const status = useAuthStatus()
  const authError = useAuthError()
  const error = useApp((s) => s.error)
  const set = useApp((s) => s.set)
  return (
    <div>
      {status === 'needsReconnect' && (
        <div className="banner" role="alert">
          <div className="grow">
            <strong>{t('auth.reconnectTitle')}</strong>
            {authError === 'popup_failed_to_open' ? t('auth.popupBlocked') : t('auth.reconnectText')}
          </div>
          <button className="btn primary" onClick={() => auth.signIn()}>
            {t('auth.reconnect')}
          </button>
        </div>
      )}
      {error && (
        <div className="banner" role="alert">
          <div className="grow">{t(error)}</div>
          <button className="icon-btn small" onClick={() => set({ error: null })} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}

interface ToolbarProps {
  lib: Library
  people: People
  count: number
  onDialog: (d: DialogState) => void
  onAdd: () => void
  onCompress: () => void
}

/**
 * One row: [title + folder actions] [view, sort, type] … count … [Add, Compress].
 * Logical order: in Hebrew the whole row is mirrored automatically.
 */
function Toolbar({ lib, people, count, onDialog, onAdd, onCompress }: ToolbarProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)

  const special =
    filters.categoryId === UNFILED || filters.categoryId === TO_CLASSIFY || filters.categoryId === AUTO || filters.categoryId === PEOPLE || !!filters.personId
  const folderId = filters.albumId ?? (!special ? filters.categoryId : null)
  const folder = folderId ? lib.folders.get(folderId) : undefined
  const folderCount = useMemo(() => {
    if (!folder) return 0
    const find = (list: typeof lib.categories): number | undefined => {
      for (const f of list) {
        if (f.id === folder.id) return f.count
        const sub = find(f.children)
        if (sub !== undefined) return sub
      }
    }
    return find(lib.categories) ?? 0
  }, [folder, lib])

  const person = filters.personId ? people.byId.get(filters.personId) : undefined
  const title = person
    ? (person.name ?? t('faces.unnamed'))
    : filters.categoryId === PEOPLE
      ? t('faces.people')
      : filters.categoryId === UNFILED
      ? t('nav.unfiled')
      : filters.categoryId === TO_CLASSIFY
        ? t('classify.toClassify')
        : filters.categoryId === AUTO
          ? t('classify.autoView')
          : folder
            ? folder.name
            : t('nav.allMedia')


  if (filters.categoryId === PEOPLE) {
    return (
      <div className="toolbar">
        <h1>
          <bdi>{title}</bdi>
        </h1>
      </div>
    )
  }

  const showTitle = special || !!folder
  return (
    <div className="toolbar">
      {showTitle && (
        <h1>
          <bdi>{title}</bdi>
        </h1>
      )}

      {folder && (
        <span className="row">
          <button
            className="icon-btn small"
            title={t('nav.newAlbum')}
            aria-label={t('nav.newAlbum')}
            onClick={() => onDialog({ kind: 'newAlbum', parentId: folder.id, parentName: folder.name })}
          >
            <FolderPlus size={18} />
          </button>
          <button
            className="icon-btn small"
            title={t('common.rename')}
            aria-label={t('common.rename')}
            onClick={() => onDialog({ kind: 'rename', id: folder.id, name: folder.name })}
          >
            <Pencil size={18} />
          </button>
          <button
            className="icon-btn small"
            title={t('common.delete')}
            aria-label={t('common.delete')}
            onClick={() => onDialog({ kind: 'delete', id: folder.id, name: folder.name, count: folderCount })}
          >
            <Trash2 size={18} />
          </button>
        </span>
      )}
      <div className="segmented" role="group" aria-label={t('gallery.viewGrid')}>
        <button aria-pressed={settings.view === 'grid'} onClick={() => updateSettings({ view: 'grid' })} title={t('gallery.viewGrid')}>
          <LayoutGrid size={16} />
          <span className="only-desktop">{t('gallery.viewGrid')}</span>
        </button>
        <button aria-pressed={settings.view === 'albums'} onClick={() => updateSettings({ view: 'albums' })} title={t('gallery.viewAlbums')}>
          <Rows3 size={16} />
          <span className="only-desktop">{t('gallery.viewAlbums')}</span>
        </button>
      </div>
      <select
        aria-label={t('gallery.sort')}
        value={settings.sort}
        onChange={(e) => updateSettings({ sort: e.target.value as typeof settings.sort })}
      >
        <option value="newest">{t('gallery.sortNewest')}</option>
        <option value="oldest">{t('gallery.sortOldest')}</option>
        <option value="name">{t('gallery.sortName')}</option>
      </select>
      <select
        aria-label={t('gallery.type')}
        value={filters.type}
        onChange={(e) => setFilters({ type: e.target.value as typeof filters.type })}
      >
        <option value="all">{t('gallery.typeAll')}</option>
        <option value="photo">{t('gallery.typePhoto')}</option>
        <option value="video">{t('gallery.typeVideo')}</option>
      </select>
      <span className="result-count" title={t('gallery.count', { count })}>
        <span className="only-desktop">{t('gallery.count', { count })}</span>
        <span className="only-mobile-inline">{fmt.number(count)}</span>
      </span>
      <span className="grow" />
      <button className="btn primary" onClick={onAdd} title={t('import.button')}>
        <ImagePlus size={16} />
        <span className="only-desktop">{t('import.button')}</span>
      </button>
      <button className="btn" onClick={onCompress} title={t('compress.button')}>
        <Minimize2 size={16} />
        <span className="only-desktop">{t('compress.button')}</span>
      </button>
    </div>
  )
}

function Toast() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const toast = useApp((s) => s.toast)
  const set = useApp((s) => s.set)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => set({ toast: null }), 8000)
    return () => clearTimeout(timer)
  }, [toast, set])
  if (!toast) return null
  return (
    <div className="toast" role="status">
      {t(toast.key, { count: toast.count, saved: toast.bytes != null ? fmt.bytes(toast.bytes) : undefined })}
      <button className="icon-btn small" onClick={() => set({ toast: null })} aria-label={t('common.close')}>
        <X size={16} />
      </button>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  const rootName = app().settings.rootName
  return (
    <div className="empty">
      <p>{t('gallery.empty')}</p>
      <p className="hint">{t('gallery.emptyHint', { name: rootName })}</p>
    </div>
  )
}
