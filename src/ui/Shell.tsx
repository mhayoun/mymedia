import { Brain, Check, CircleHelp, Eye, FolderInput, FolderSync, FolderPlus, ImagePlus, Loader2, Minimize2, Pause, Menu, Pencil, RefreshCw, Settings as SettingsIcon, Store, Trash2, UserPlus, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { knownAccounts } from '../auth/accounts'
import { sameFolderName } from '../drive/api'
import { useFormat } from '../i18n/format'
import { app, useApp, type User } from '../store'
import { createAlbum, createCategory, deleteFolder, renameFolder } from '../sync/folders'
import { cancelCompression } from '../compress/engine'
import { subtreeIds } from '../lib/tree'
import { stopIndexer } from '../ml/indexer'
import { setLibraryForWarm } from '../sync/thumbs'
import { findSharedLibraries, openLibrary } from '../sync/library'
import { cancelSync, syncNow } from '../sync/engine'
import { ActivityDialog } from './ActivityDialog'
import { CompressDialog } from './CompressDialog'
import { ConfirmDialog, PromptDialog } from './Dialog'
import { ImportDialog, lastShareDestination } from './ImportDialog'
import { Gallery } from './Gallery'
import { useAuthError, useAuthStatus, useAutoSync, useOnline } from './hooks'
import { SettingsPanel } from './SettingsPanel'
import { SpeedButton, SpeedDialog } from './SpeedButton'
import { Sidebar } from './Sidebar'
import { LibraryContext } from './libraryContext'
import { ReviewView } from './ReviewView'
import { StatsDialog } from './StatsDialog'
import { AUTO, BLURRY, DUPLICATES, filterItems, MISFILED, PEOPLE, sortItems, TO_CLASSIFY, UNFILED, useLibrary, type Library } from './useLibrary'
import { clearSharedFiles, hasSharedFiles, onNativeShare, readSharedFiles } from '../import/shared'
import { loadPro, useIsPro } from '../models/pro'
import { paypalReturn } from '../models/shop'
import { FacesIntro } from './FacesIntro'
import { HelpPanel } from './HelpPanel'
import { AccountPanel } from './AccountPanel'
import { LibraryDialog } from './LibraryDialog'
import { ModelsDialog } from './ModelsDialog'
import { ProDialog, ProGate } from './ProDialog'
import { ShareDialog } from './ShareDialog'
import { FilterBar } from './FilterBar'
import { SelectionBar } from './SelectionBar'
import { PeopleContext, PersonDialogContext } from './peopleContext'
import { PeopleView } from './PeopleView'
import { PersonDialog } from './PersonDialog'
import { MisfiledView } from './MisfiledView'
import { DuplicatesView } from './DuplicatesView'
import { BlurryView } from './BlurryView'
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
  | { kind: 'import'; destId: string; files?: File[]; fromShare?: boolean }
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
  const libraryOpen = useApp((s) => s.libraryOpen)
  const speedOpen = useApp((s) => s.speedOpen)
  const activityOpen = useApp((s) => s.activityOpen)
  const shopOpen = useApp((s) => s.shopOpen)
  const proOpen = useApp((s) => s.proOpen)
  const isPro = useIsPro()
  const email = useApp((s) => s.user?.email)
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

  useEffect(() => {
    if (email) void loadPro(email)
  }, [email])

  // Back from paying on PayPal: the shop (a model) or the Pro window finishes the purchase.
  useEffect(() => {
    if (!rootId) return
    const back = paypalReturn()
    if (back?.pro) app().set({ proOpen: true, proResume: back })
    else if (back) app().set({ shopOpen: true, shopResume: back })
  }, [rootId])

  // Files shared to MyMedia from another app (Android Share menu).
  const [sharedReadOnly, setSharedReadOnly] = useState(false)
  // Android app: files shared while MyMedia is already open.
  const [shareTick, setShareTick] = useState(0)
  useEffect(() => onNativeShare(() => setShareTick((n) => n + 1)), [])
  useEffect(() => {
    if (!rootId || !hasSharedFiles()) return
    // A library shared for viewing cannot take them: offer to open the user's own (the files wait).
    if (app().readOnly) return setSharedReadOnly(true)
    readSharedFiles().then((files) => {
      // The album chosen the last time (checked by the dialog: it may have been removed).
      const destId = lastShareDestination() ?? rootId
      if (files.length) setDialog({ kind: 'import', destId, files, fromShare: true })
      else {
        // Why, for the user to tell: what the service worker received, or how many it kept.
        const why = new URLSearchParams(location.search).get('why') ?? `kept ${new URLSearchParams(location.search).get('shared')}`
        void clearSharedFiles()
        if (why.startsWith('received nothing')) {
          // Chrome on Android (since version 153) sends the share without its files: the user picks them here instead.
          console.warn('[MyMedia] share without files', why)
          setDialog({ kind: 'import', destId, fromShare: true })
          app().set({ toast: { key: 'shareIn.chromeEmpty' } })
        } else app().set({ toast: { key: 'shareIn.notReceived', detail: why } })
      }
    })
  }, [rootId, shareTick])

  const personMedia = filters.personId ? people.byId.get(filters.personId)?.mediaIds : undefined
  // Folder shown (album or category), used by Add and Compress in the top bar.
  const specialView = [UNFILED, TO_CLASSIFY, AUTO, PEOPLE, MISFILED, DUPLICATES, BLURRY].includes(filters.categoryId ?? '') || !!filters.personId || !!filters.provenance
  const currentFolderId = filters.albumId ?? (!specialView && filters.categoryId && lib.folders.has(filters.categoryId) ? filters.categoryId : null)
  const currentTitle = currentFolderId
    ? (lib.folders.get(currentFolderId)?.name ?? '')
    : filters.personId
      ? (people.byId.get(filters.personId)?.name ?? t('faces.unnamed'))
      : filters.provenance
        ? provenance.title(lib, filters.provenance)
        : t('nav.allMedia')
  // Screens without the search line (Add and Compress then go in the toolbar, if it has them).
  const noSearch = [PEOPLE, MISFILED, DUPLICATES, BLURRY].includes(filters.categoryId ?? '')
  const addCompress = !readOnly && (
    <>
      <button className="btn primary" onClick={() => setDialog({ kind: 'import', destId: currentFolderId ?? rootId! })} title={t('import.button')}>
        <ImagePlus size={16} />
        <span className="only-desktop">{t('import.button')}</span>
      </button>
      <button className="btn" onClick={() => setDialog({ kind: 'compress', title: t('compress.titleFor', { name: currentTitle }), folderId: currentFolderId })} title={t('compress.button')}>
        <Minimize2 size={16} />
        <span className="only-desktop">{t('compress.button')}</span>
      </button>
    </>
  )
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
            actions={filters.categoryId === MISFILED ? addCompress : undefined}
          />
          {!noSearch && <FilterBar people={people} lib={lib} actions={addCompress} />}
          </div>
          {filters.categoryId === PEOPLE ? (
            <PeopleView people={people} />
          ) : filters.categoryId === MISFILED ? (
            <MisfiledView lib={lib} />
          ) : filters.categoryId === DUPLICATES ? (
            isPro ? <DuplicatesView lib={lib} /> : <ProGate feature={t('cleanup.duplicates')} />
          ) : filters.categoryId === BLURRY ? (
            isPro ? <BlurryView lib={lib} /> : <ProGate feature={t('cleanup.blurry')} />
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
      {libraryOpen && <LibraryDialog />}
      {shareOpen && <ShareDialog mode={shareOpen} onClose={() => app().set({ shareOpen: false })} />}
      {shopOpen && <ModelsDialog view={shopOpen === 'publish' ? 'publish' : 'use'} onClose={() => app().set({ shopOpen: false, shopResume: null })} />}
      {proOpen && <ProDialog onClose={() => app().set({ proOpen: false, proResume: null })} />}
      {statsOpen && <StatsDialog lib={lib} />}
      {speedOpen && <SpeedDialog onClose={() => app().set({ speedOpen: false })} />}
      {activityOpen && <ActivityDialog onClose={() => app().set({ activityOpen: false })} />}
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
          fromShare={dialog.fromShare}
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
  const user = useApp((s) => s.user)
  // Whether another account shares its MyMedia with this one (else no eye on one's own).
  const [othersShared, setOthersShared] = useState(false)
  useEffect(() => {
    let alive = true
    findSharedLibraries().then((l) => alive && setOthersShared(l.length > 0), () => undefined)
    return () => {
      alive = false
    }
  }, [user?.email])

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
      {/* Another account's MyMedia is open: green, with whose it is (computer). */}
      {shared && (
        <button
          className="sync-info shared-badge on"
          onClick={() => set({ libraryOpen: true })}
          aria-label={t('library.title')}
          title={t(readOnly ? 'library.readOnlyHint' : 'library.sharedHint', { owner: shared.ownerName ?? shared.ownerEmail ?? '' })}
        >
          <Eye size={14} />
          <span className="only-desktop">
            {' '}
            {t(readOnly ? 'library.readOnlyOf' : 'library.sharedOf', { owner: shared.ownerName ?? shared.ownerEmail ?? '' })}
          </span>
        </button>
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
          <button className="sync-info as-link" aria-live="polite" onClick={() => set({ activityOpen: true })} title={t('activity.title')}>
            <RefreshCw size={14} className="spin" />
            <span className="only-desktop"> {t(sync.step, { done: fmt.number(sync.done), total: fmt.number(sync.total) })}</span>
            <span className="only-mobile-inline">{sync.total ? `${fmt.number(sync.done)}/${fmt.number(sync.total)}` : sync.done ? fmt.number(sync.done) : ''}</span>
          </button>
          <button className="icon-btn small" onClick={cancelSync} aria-label={t('sync.cancel')} title={t('sync.cancel')}>
            <X size={18} />
          </button>
        </>
      ) : (
        <>
          <button className="sync-info as-link only-desktop" onClick={() => set({ activityOpen: true })} title={t('activity.title')}>
            {lastSyncAt ? t('sync.lastSync', { time: fmt.time(lastSyncAt) }) : ''}
          </button>
          <button
            className="btn"
            onClick={() => {
              void syncNow()
              set({ activityOpen: true })
            }}
            disabled={!online}
            title={t('gallery.loadNew')}
          >
            <RefreshCw size={16} />
            <span className="only-desktop">{t('gallery.loadNew')}</span>
          </button>
        </>
      )}

      <SpeedButton />
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
      {/* One's own MyMedia, others share theirs: a grey eye next to the account to open them. */}
      {!shared && othersShared && (
        <button className="icon-btn library-btn" onClick={() => set({ libraryOpen: true })} aria-label={t('library.title')} title={t('library.title')}>
          <Eye />
        </button>
      )}
      <AccountButton />
    </header>
  )
}

/**
 * The account photo: with several accounts used on this device, their list
 * (one tap opens MyMedia on it); with one, the account panel straight away.
 */
function AccountButton() {
  const { t } = useTranslation()
  const user = useApp((s) => s.user)
  const set = useApp((s) => s.set)
  const [accounts, setAccounts] = useState<User[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    knownAccounts().then((l) => alive && setAccounts(l), () => undefined)
    return () => {
      alive = false
    }
  }, [user?.email])
  const me = user?.email.toLowerCase()
  const others = accounts.filter((a) => a.email.toLowerCase() !== me)
  const avatar = (u: User | null, big = false) =>
    u?.photo ? <img className={`avatar${big ? ' mid' : ''}`} src={u.photo} alt="" referrerPolicy="no-referrer" /> : <UserRound />
  return (
    <span className="account-menu-anchor">
      <button
        className="icon-btn"
        onClick={() => (others.length ? setOpen(!open) : set({ accountOpen: true }))}
        aria-label={t('nav.account')}
        aria-expanded={others.length ? open : undefined}
        title={user?.email ?? t('nav.account')}
      >
        {avatar(user)}
      </button>
      {open && (
        <>
          <div className="account-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="account-menu" role="menu">
            <button role="menuitem" onClick={() => (setOpen(false), set({ accountOpen: true }))}>
              {avatar(user, true)}
              <span>
                {user?.name && <strong>{user.name}</strong>}
                <span className="hint" dir="ltr">{user?.email}</span>
              </span>
              <Check size={16} />
            </button>
            {others.map((a) => (
              <button key={a.email} role="menuitem" onClick={() => auth.switchTo(a.email)}>
                {avatar(a, true)}
                <span>
                  {a.name && <strong>{a.name}</strong>}
                  <span className="hint" dir="ltr">{a.email}</span>
                </span>
              </button>
            ))}
            <button role="menuitem" onClick={() => auth.signIn(true)}>
              <UserPlus size={20} />
              <span>{t('auth.switchAccount')}</span>
            </button>
          </div>
        </>
      )}
    </span>
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
  /** Add and Compress, when the search line is not shown. */
  actions?: React.ReactNode
}

/**
 * One row: [title + folder actions] [view, sort, type] … count … [Add, Compress].
 * Logical order: in Hebrew the whole row is mirrored automatically.
 */
function Toolbar({ lib, people, count, onDialog, actions }: ToolbarProps) {
  const { t } = useTranslation()
  const provenance = useProvenanceLabel()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const readOnly = useApp((s) => s.readOnly)

  const special =
    filters.categoryId === UNFILED || filters.categoryId === TO_CLASSIFY || filters.categoryId === AUTO || filters.categoryId === PEOPLE || filters.categoryId === MISFILED || filters.categoryId === DUPLICATES || filters.categoryId === BLURRY || !!filters.personId || !!filters.provenance
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
      : filters.categoryId === DUPLICATES
      ? t('cleanup.duplicates')
      : filters.categoryId === BLURRY
      ? t('cleanup.blurry')
      : filters.categoryId === UNFILED
      ? t('nav.unfiled')
      : filters.categoryId === TO_CLASSIFY
        ? t('classify.toClassify')
        : filters.categoryId === AUTO
          ? t('classify.autoView')
          : folder
            ? folder.name
            : t('nav.allMedia')


  if (filters.categoryId === PEOPLE || filters.categoryId === DUPLICATES || filters.categoryId === BLURRY) {
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
      <select
        aria-label={t('gallery.groupBy')}
        title={t('gallery.groupBy')}
        value={settings.view}
        onChange={(e) => updateSettings({ view: e.target.value as typeof settings.view })}
      >
        <option value="grid">{t('gallery.viewGrid')}</option>
        <option value="albums">{t('gallery.viewAlbums')}</option>
        <option value="years">{t('gallery.viewYears')}</option>
        <option value="months">{t('gallery.viewMonths')}</option>
      </select>
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
      {actions}
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
