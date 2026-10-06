import { Brain, FolderPlus, LayoutGrid, Minimize2, Pause, Menu, Pencil, RefreshCw, Rows3, Settings as SettingsIcon, Trash2, WifiOff, X } from 'lucide-react'
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
import { Gallery } from './Gallery'
import { useAuthError, useAuthStatus, useAutoSync, useOnline } from './hooks'
import { SettingsPanel } from './SettingsPanel'
import { Sidebar } from './Sidebar'
import { LibraryContext } from './libraryContext'
import { ReviewView } from './ReviewView'
import { StatsDialog } from './StatsDialog'
import { AUTO, filterItems, sortItems, TO_CLASSIFY, UNFILED, useLibrary, type Library } from './useLibrary'

type DialogState =
  | { kind: 'newCategory' }
  | { kind: 'newAlbum'; parentId: string; parentName: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'delete'; id: string; name: string; count: number }
  | { kind: 'compress'; title: string; folderId: string | null }
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
  useAutoSync()

  const items = useMemo(
    () => (rootId ? sortItems(filterItems(lib, filters, rootId), sort) : []),
    [lib, filters, rootId, sort],
  )

  const siblingsHaveName = (parentId: string, name: string, exceptId?: string) =>
    [...lib.folders.values()].some(
      (f) => f.parentId === parentId && f.id !== exceptId && f.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
    )

  return (
    <LibraryContext.Provider value={lib}>
    <div className="shell">
      <TopBar />
      <Banners />
      <div className="body">
        <Sidebar lib={lib} onNewCategory={() => setDialog({ kind: 'newCategory' })} />
        <main className="main">
          <Toolbar lib={lib} count={items.length} onDialog={setDialog} />
          {lib.ready && items.length === 0 ? (
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
    </div>
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
            <Minimize2 size={14} /> {t('compress.progress', { done: fmt.number(compressing.done + 1), total: fmt.number(compressing.total) })}
          </span>
          <button className="icon-btn small" onClick={cancelCompression} aria-label={t('common.cancel')} title={t('common.cancel')}>
            <X size={16} />
          </button>
        </>
      )}
      {indexing && !sync && !compressing && (
        <>
          <span className="sync-info" aria-live="polite" title={t('classify.learningHint')}>
            <Brain size={14} /> {t('classify.learning', { done: fmt.number(indexing.done), total: fmt.number(indexing.total) })}
          </span>
          <button className="icon-btn small" onClick={stopIndexer} aria-label={t('classify.pause')} title={t('classify.pause')}>
            <Pause size={16} />
          </button>
        </>
      )}
      {sync ? (
        <>
          <span className="sync-info" aria-live="polite">
            <RefreshCw size={14} className="spin" /> {t(sync.step, { done: fmt.number(sync.done), total: fmt.number(sync.total) })}
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
          <button className="btn" onClick={() => void syncNow()} disabled={!online}>
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

function Toolbar({ lib, count, onDialog }: { lib: Library; count: number; onDialog: (d: DialogState) => void }) {
  const { t } = useTranslation()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)

  const special = filters.categoryId === UNFILED || filters.categoryId === TO_CLASSIFY || filters.categoryId === AUTO
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

  const title =
    filters.categoryId === UNFILED
      ? t('nav.unfiled')
      : filters.categoryId === TO_CLASSIFY
        ? t('classify.toClassify')
        : filters.categoryId === AUTO
          ? t('classify.autoView')
          : folder
            ? folder.name
            : t('nav.allMedia')

  return (
    <div className="toolbar">
      <h1>
        <bdi>{title}</bdi>
        <span className="count">{t('gallery.count', { count })}</span>
      </h1>
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
      <button
        className="icon-btn small"
        title={t('compress.button')}
        aria-label={t('compress.button')}
        onClick={() => onDialog({ kind: 'compress', title: t('compress.titleFor', { name: title }), folderId: folder?.id ?? null })}
      >
        <Minimize2 size={18} />
      </button>
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
