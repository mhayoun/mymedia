import { Brain, CircleHelp, Eye, FolderInput, FolderSync, FolderPlus, ImagePlus, LayoutGrid, Loader2, Minimize2, Pause, Menu, Pencil, RefreshCw, Rows3, Settings as SettingsIcon, Store, Trash2, UserRound, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { sameFolderName } from '../drive/api'
import { useFormat } from '../i18n/format'
import { app, useApp } from '../store'
import { createAlbum, createCategory, deleteFolder, renameFolder } from '../sync/folders'
import { cancelCompression } from '../compress/engine'
import { subtreeIds } from '../lib/tree'
import { stopIndexer } from '../ml/indexer'
import { setLibraryForWarm } from '../sync/thumbs'
import { openLibrary } from '../sync/library'
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
import { AUTO, filterItems, MISFILED, PEOPLE, sortItems, TO_CLASSIFY, UNFILED, useLibrary, type Library } from './useLibrary'
import { clearSharedFiles, hasSharedFiles, readSharedFiles } from '../import/shared'
import { paypalReturn } from '../models/shop'
import { FacesIntro } from './FacesIntro'
import { HelpPanel } from './HelpPanel'
import { AccountPanel } from './AccountPanel'
import { ModelsDialog } from './ModelsDialog'
import { ShareDialog } from './ShareDialog'
import { FilterBar } from './FilterBar'
import { SelectionBar } from './SelectionBar'
import { PeopleContext, PersonDialogContext } from './peopleContext'
import { PeopleView } from './PeopleView'
import { PersonDialog } from './PersonDialog'
import { MisfiledView } from './MisfiledView'
import { MoveFolderDialog } from './MoveFolderDialog'
import { usePeople, type People } from './usePeople'
import { useProvenanceLabel } from './useProvenanceLabel'

type DialogState =
  | { kind: 'newCategory' }
  | { kind: 'newAlbum'; parentId: string; parentName: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'move'; id: string; name: string; count: number }
  | { kind: 'delete'; id: string; name: string; count: number }
  | { kind: 'compress'; title: string; folderId: string | null }
  | { kind: 'import'; destId: string; files?: File[] }
  | null

export function Shell() {
  const { t } = useTranslation()
  const provenance = useProvenanceLabel()
  const lib = useLibrary()
  const rootId = useApp((s) => s.rootId)
  const filters = useApp((s) => s.filters)
  const sort = useApp((s) => s.settings.sort)
  const sidebarHidden = useApp((s) => !!s.settings.sidebarHidden)
  const savedSidebarWidth = useApp((s) => s.settings.sidebarWidth)
  // While dragging, before it is saved.
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const sidebarWidth = dragWidth ?? savedSidebarWidth
  const setSidebarWidth = (w: number | null, done?: boolean) => {
    if (!done) return setDragWidth(w)
    setDragWidth(null)
    app().updateSettings({ sidebarWidth: w ?? undefined })
  }
  const settingsOpen = useApp((s) => s.settingsOpen)
  const helpOpen = useApp((s) => s.helpOpen)
  const accountOpen = useApp((s) => s.accountOpen)
  const shopOpen = useApp((s) => s.shopOpen)
  const shareOpen = useApp((s) => s.shareOpen)
  const statsOpen = useApp((s) => s.statsOpen)
  const compressOffer = useApp((s) => s.compressOffer)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [personOpen, setPersonOpen] = useState<string | null>(null)
  const selection = useApp((s) => s.selection)
  const readOnly = useApp((s) => s.readOnly)
  const people = usePeople()
  useAutoSync()
  useEffect(() => setLibraryForWarm(lib.items.map((i) => i.rec)), [lib.items])

  // Back from paying a model on PayPal: the shop finishes the purchase.
  useEffect(() => {
    if (!rootId) return
    const back = paypalReturn()
    if (back) app().set({ shopOpen: true, shopResume: back })
  }, [rootId])

  // Files shared to MyMedia from another app (Android Share menu).
  const [sharedReadOnly, setSharedReadOnly] = useState(false)
  useEffect(() => {
    if (!rootId || !hasSharedFiles()) return
    // A library shared for viewing cannot take them: offer to open the user's own (the files wait).
    if (app().readOnly) return setSharedReadOnly(true)
    readSharedFiles().then((files) => {
      if (files.length) setDialog({ kind: 'import', destId: rootId, files })
      else {
        // Why, for the user to tell: what the service worker received, or how many it kept.
        const why = new URLSearchParams(location.search).get('why') ?? `kept ${new URLSearchParams(location.search).get('shared')}`
        void clearSharedFiles()
        if (why.startsWith('received nothing')) {
          // Chrome on Android (since version 153) sends the share without its files: the user picks them here instead.
          console.warn('[MyMedia] share without files', why)
          setDialog({ kind: 'import', destId: rootId })
          app().set({ toast: { key: 'shareIn.chromeEmpty' } })
        } else app().set({ toast: { key: 'shareIn.notReceived', detail: why } })
      }
    })
  }, [rootId])

  const personMedia = filters.personId ? people.byId.get(filters.personId)?.mediaIds : undefined
  // Folder shown (album or category), used by Add and Compress in the top bar.
  const specialView = [UNFILED, TO_CLASSIFY, AUTO, PEOPLE, MISFILED].includes(filters.categoryId ?? '') || !!filters.personId || !!filters.provenance
  const currentFolderId = filters.albumId ?? (!specialView && filters.categoryId && lib.folders.has(filters.categoryId) ? filters.categoryId : null)
  const currentTitle = currentFolderId
    ? (lib.folders.get(currentFolderId)?.name ?? '')
    : filters.personId
      ? (people.byId.get(filters.personId)?.name ?? t('faces.unnamed'))
      : filters.provenance
        ? provenance.title(lib, filters.provenance)
        : t('nav.allMedia')
  const items = useMemo(
    () => (rootId ? sortItems(filterItems(lib, filters, rootId, personMedia ?? new Set()), sort) : []),
    [lib, filters, rootId, sort, personMedia],
  )

  const siblingsHaveName = (parentId: string, name: string, exceptId?: string) =>
    [...lib.folders.values()].some(
      (f) => f.parentId === parentId && f.id !== exceptId && sameFolderName(f.name, name),
    )

  return (
    <LibraryContext.Provider value={lib}>
    <PeopleContext.Provider value={people}>
    <PersonDialogContext.Provider value={setPersonOpen}>
    <div className={`shell ${selection ? 'selecting' : ''}`}>
      <TopBar />
      <Banners />
      <div className={`body ${sidebarHidden ? 'sidebar-hidden' : ''}`} style={sidebarWidth ? ({ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties) : undefined}>
        <Sidebar lib={lib} people={people} onNewCategory={() => setDialog({ kind: 'newCategory' })} />
        {!sidebarHidden && <SidebarResizer onWidth={setSidebarWidth} />}
        <main className="main">
          <div className="controls">
          <Toolbar
            lib={lib}
            people={people}
            count={items.length}
            onDialog={setDialog}
            onAdd={() => setDialog({ kind: 'import', destId: currentFolderId ?? rootId! })}
            onCompress={() => setDialog({ kind: 'compress', title: t('compress.titleFor', { name: currentTitle }), folderId: currentFolderId })}
          />
          {filters.categoryId !== PEOPLE && filters.categoryId !== MISFILED && <FilterBar people={people} lib={lib} />}
          </div>
          {filters.categoryId === PEOPLE ? (
            <PeopleView people={people} />
          ) : filters.categoryId === MISFILED ? (
            <MisfiledView lib={lib} />
          ) : lib.ready && items.length === 0 ? (
            <EmptyState />
          ) : filters.categoryId === TO_CLASSIFY || filters.categoryId === AUTO ? (
            <ReviewView lib={lib} items={items} mode={filters.categoryId === AUTO ? 'auto' : 'classify'} />
          ) : (
            <Gallery items={items} folderId={currentFolderId} folders={lib.folders} />
          )}
        </main>
      </div>
      {settingsOpen && <SettingsPanel />}
      {helpOpen && <HelpPanel />}
      {accountOpen && <AccountPanel />}
      {shareOpen && <ShareDialog onClose={() => app().set({ shareOpen: false })} />}
      {shopOpen && <ModelsDialog onClose={() => app().set({ shopOpen: false, shopResume: null })} />}
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
      {dialog?.kind === 'move' && <MoveFolderDialog lib={lib} id={dialog.id} name={dialog.name} count={dialog.count} onClose={() => setDialog(null)} />}
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
      {filters.categoryId !== PEOPLE && rootId && !readOnly && (
        <SelectionBar lib={lib} people={people} items={items} parentId={filters.albumId ?? (filters.categoryId && lib.folders.has(filters.categoryId) ? filters.categoryId : rootId)} />
      )}
      {sharedReadOnly && (
        <ConfirmDialog
          title={t('shareIn.readOnlyTitle')}
          text={t('shareIn.readOnlyText')}
          confirmLabel={t('library.backToMine')}
          onConfirm={() => {
            // The page opens again on the user's own library, the shared files still waiting.
            openLibrary(app().user!.email, null)
            return new Promise<void>(() => {})
          }}
          onClose={() => {
            setSharedReadOnly(false)
            void clearSharedFiles()
          }}
        />
      )}
      {personOpen && <PersonDialog people={people} personId={personOpen} onClose={() => setPersonOpen(null)} />}
      {!readOnly && <FacesIntro people={people} />}
    </div>
    </PersonDialogContext.Provider>
    </PeopleContext.Provider>
    </LibraryContext.Provider>
  )
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 600

/** Computer: the edge of the side menu, dragged to make it wider or narrower (double-click: default width). */
function SidebarResizer({ onWidth }: { onWidth: (w: number | null, done?: boolean) => void }) {
  const { t } = useTranslation()
  const widthAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const body = e.currentTarget.parentElement!.getBoundingClientRect()
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    const w = rtl ? body.right - e.clientX : e.clientX - body.left
    return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)))
  }
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('nav.resize')}
      title={t('nav.resize')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onWidth(widthAt(e))
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        onWidth(widthAt(e), true)
      }}
      onDoubleClick={() => onWidth(null, true)}
    />
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
  const moving = useApp((s) => s.moving)
  const working = useApp((s) => s.working)
  const set = useApp((s) => s.set)
  const readOnly = useApp((s) => s.readOnly)
  const shared = useApp((s) => s.shared)
  const online = useOnline()

  return (
    <header className="topbar">
      <button
        className="icon-btn"
        onClick={() =>
          // Phone: the menu slides over the photos. Computer: it is closed or opened, and stays so.
          window.matchMedia('(max-width: 800px)').matches
            ? set({ sidebarOpen: true })
            : app().updateSettings({ sidebarHidden: !app().settings.sidebarHidden })
        }
        aria-label={t('nav.menu')}
        title={t('nav.menu')}
      >
        <Menu />
      </button>
      <div className="title">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <span>{t('app.name')}</span>
      </div>
      {shared && (
        <button className="sync-info shared-badge" onClick={() => set({ accountOpen: true })} title={t(readOnly ? 'library.readOnlyHint' : 'library.sharedHint', { owner: shared.ownerName ?? shared.ownerEmail ?? '' })}>
          <Eye size={14} />
          <span className="only-desktop">
            {' '}
            {t(readOnly ? 'library.readOnlyOf' : 'library.sharedOf', { owner: shared.ownerName ?? shared.ownerEmail ?? '' })}
          </span>
        </button>
      )}
      {!online && (
        <span className="sync-info" title={t('sync.offline')}>
          <WifiOff size={18} />
        </span>
      )}
      {working && !indexing && (
        <span className="sync-info" aria-live="polite" title={t('classify.workingHint')}>
          <Loader2 size={14} className="spin" />
          <span className="only-desktop"> {t(working)}</span>
        </span>
      )}
      {moving > 0 && (
        <span className="sync-info" title={t('sync.movingHint')}>
          <FolderSync size={14} />
          <span className="only-desktop"> {t('sync.moving', { count: fmt.number(moving) })}</span>
          <span className="only-mobile-inline">{fmt.number(moving)}</span>
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
      {indexing && !compressing && (
        <>
          <button
            className="learning-pill"
            aria-live="polite"
            title={t('classify.learningHint')}
            onClick={() => set({ statsOpen: true })}
            style={{ '--pct': `${indexing.total ? Math.round((indexing.done / indexing.total) * 100) : 0}%` } as React.CSSProperties}
          >
            <Brain size={16} className="pulse" />
            <span className="only-desktop">{t('classify.learning', { done: fmt.number(indexing.done), total: fmt.number(indexing.total) })}</span>
            <span className="only-mobile-inline">{fmt.number(indexing.done)}/{fmt.number(indexing.total)}</span>
          </button>
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

      <button className="icon-btn" onClick={() => set({ helpOpen: true })} aria-label={t('nav.help')} title={t('nav.help')}>
        <CircleHelp />
      </button>
      {!readOnly && (
        <button className="icon-btn shop-btn" onClick={() => set({ shopOpen: true })} aria-label={t('nav.shop')} title={t('nav.shop')}>
          <Store />
        </button>
      )}
      <button className="icon-btn" onClick={() => set({ settingsOpen: true })} aria-label={t('nav.settings')} title={t('nav.settings')}>
        <SettingsIcon />
      </button>
      <button className="icon-btn" onClick={() => set({ accountOpen: true })} aria-label={t('nav.account')} title={user?.email ?? t('nav.account')}>
        {user?.photo ? <img className="avatar" src={user.photo} alt="" referrerPolicy="no-referrer" /> : <UserRound />}
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
        <div className="banner reconnect" role="alert">
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
  const provenance = useProvenanceLabel()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const readOnly = useApp((s) => s.readOnly)

  const special =
    filters.categoryId === UNFILED || filters.categoryId === TO_CLASSIFY || filters.categoryId === AUTO || filters.categoryId === PEOPLE || filters.categoryId === MISFILED || !!filters.personId || !!filters.provenance
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
    : filters.provenance
      ? provenance.title(lib, filters.provenance)
      : filters.categoryId === PEOPLE
      ? t('faces.people')
      : filters.categoryId === MISFILED
      ? t('misfiled.title')
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
      <div className="toolbar-title">
        <h1>
          <bdi>{title}</bdi>
        </h1>
      {folder && !readOnly && (
        <span className="row">
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
            title={t('nav.newAlbum')}
            aria-label={t('nav.newAlbum')}
            onClick={() => onDialog({ kind: 'newAlbum', parentId: folder.id, parentName: folder.name })}
          >
            <FolderPlus size={18} />
          </button>
          <button
            className="icon-btn small"
            title={t('folders.move')}
            aria-label={t('folders.move')}
            onClick={() => onDialog({ kind: 'move', id: folder.id, name: folder.name, count: folderCount })}
          >
            <FolderInput size={18} />
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
      </div>
      )}
      <div className="toolbar-controls">
      <button
        className="btn view-toggle"
        onClick={() => updateSettings({ view: settings.view === 'grid' ? 'albums' : 'grid' })}
        title={settings.view === 'grid' ? t('gallery.viewAlbums') : t('gallery.viewGrid')}
        aria-label={settings.view === 'grid' ? t('gallery.viewAlbums') : t('gallery.viewGrid')}
      >
        {/* One button: shows the view it switches to. */}
        {settings.view === 'grid' ? <Rows3 size={16} /> : <LayoutGrid size={16} />}
        <span className="only-desktop">{settings.view === 'grid' ? t('gallery.viewAlbums') : t('gallery.viewGrid')}</span>
      </button>
      <select
        aria-label={t('gallery.sort')}
        value={settings.sort}
        onChange={(e) => updateSettings({ sort: e.target.value as typeof settings.sort })}
      >
        <option value="newest">{t('gallery.sortNewest')}</option>
        <option value="oldest">{t('gallery.sortOldest')}</option>
        <option value="name">{t('gallery.sortName')}</option>
        <option value="largest">{t('gallery.sortLargest')}</option>
        <option value="smallest">{t('gallery.sortSmallest')}</option>
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
        {t('gallery.count', { count })}
      </span>
      <span className="grow" />
      {!readOnly && (
        <>
          <button className="btn primary" onClick={onAdd} title={t('import.button')}>
            <ImagePlus size={16} />
            <span className="only-desktop">{t('import.button')}</span>
          </button>
          <button className="btn" onClick={onCompress} title={t('compress.button')}>
            <Minimize2 size={16} />
            <span className="only-desktop">{t('compress.button')}</span>
          </button>
        </>
      )}
      </div>
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
      {t(toast.key, { count: toast.count, saved: toast.bytes != null ? fmt.bytes(toast.bytes) : undefined, detail: toast.detail ?? '' })}
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
