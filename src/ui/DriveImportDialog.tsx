import { ChevronRight, CircleHelp, FileText, Folder, HardDrive, Image, ImagePlus, Loader2, Users, Video } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DriveFile } from '../drive/api'
import { useFormat } from '../i18n/format'
import { cancelDriveImport, collect, importFromDrive, isFolder, listShared, markDuplicates, takenAtOf, type DriveEntry } from '../import/fromDrive'
import { CategoryProposal, useCategoryProposal, type ProposalAlbum } from './CategoryProposal'
import { useApp } from '../store'
import { albumDirs } from '../lib/folderNames'
import { Modal } from './Dialog'
import { FolderTreePicker } from './FolderTreePicker'
import { DiskBackup } from './DiskBackup'
import { GroupName, PickedPhotos, sizeOf, useDrivePick } from './DrivePick'
import { MyDriveImport } from './MyDriveImport'
import { driveItems } from '../import/diskBackup'
import { ProGate } from './ProDialog'
import type { Library } from './useLibrary'

type Phase = 'browse' | 'collect' | 'propose' | 'copy' | 'done'

/**
 * Import → "From Google Drive": "My photos in Google Drive" (chosen in Google's window, moved into MyMedia: any
 * access, MyMedia Free too), "Save to the disk" (the same photos chosen, their originals saved on the computer),
 * or the files other accounts shared with this one, copied by Google into MyMedia (only the full Drive access,
 * Pro, sees them).
 */
export function DriveImportDialog(props: { lib: Library; destId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const door = useApp((s) => s.door)
  const [source, setSource] = useState<'mine' | 'backup' | 'shared'>('mine')
  const [destId, setDestId] = useState(props.destId)
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  const onBusy = useCallback((b: boolean) => setBusy(b), [])
  // Chosen once, for the import and the backup.
  const pick = useDrivePick()
  const backupItems = useMemo(() => driveItems(pick.groups), [pick.groups])
  if (source === 'shared' && door === 'full') return <DriveImport {...props} onMine={() => setSource('mine')} />
  const tab = (id: typeof source, icon: ReactNode, label: string) => (
    <button className={`btn ${source === id ? 'primary' : 'ghost'} small`} role="tab" aria-selected={source === id} onClick={() => setSource(id)}>
      {icon} {label}
    </button>
  )
  return (
    <Modal
      wide
      title={t('driveImport.title')}
      onClose={() => !busy && props.onClose()}
      titleExtra={
        source !== 'shared' ? (
          <button
            className={`icon-btn small ${help ? 'active' : ''}`}
            onClick={() => setHelp((v) => !v)}
            aria-expanded={help}
            title={t('myDrive.helpButton')}
            aria-label={t('myDrive.helpButton')}
          >
            <CircleHelp size={18} />
          </button>
        ) : undefined
      }
    >
      {!busy && (
        <div className="row" role="tablist">
          {tab('mine', <ImagePlus size={14} />, t('myDrive.tab'))}
          {tab('backup', <HardDrive size={14} />, t('backup.tab'))}
          {tab('shared', <Users size={14} />, t('driveImport.shared'))}
        </div>
      )}
      {help && source !== 'shared' && <MyDriveHelp onClose={() => setHelp(false)} />}
      {source === 'mine' && (
        <MyDriveImport pick={pick} lib={props.lib} destId={destId} onDestChange={setDestId} onBackup={() => setSource('backup')} onBusy={onBusy} onClose={props.onClose} />
      )}
      {source === 'backup' && (
        <DiskBackup
          items={backupItems}
          blocked={pick.groups.some((g) => !g.album.trim())}
          onBusy={onBusy}
          onClose={props.onClose}
          next={{ label: t('backup.thenImport'), run: () => setSource('mine') }}
          before={
            <>
              <PickedPhotos pick={pick} count={backupItems.length} size={sizeOf(pick.groups.flatMap((g) => g.files))} />
              {pick.groups.length > 0 && (
                <section className="disk-sync-part">
                  <h3>{t('backup.namesTitle')}</h3>
                  {pick.groups.map((g) => (
                    <GroupName key={g.key} pick={pick} g={g} files={g.files} label={t('backup.folderName')} />
                  ))}
                </section>
              )}
            </>
          }
        />
      )}
      {source === 'shared' && (
        <>
          <ProGate feature={t('driveImport.title')} needsFull />
          <div className="actions">
            <button className="btn" onClick={props.onClose}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** The "?" by the title: how the import and the backup work, step by step. */
function MyDriveHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const v = t('myDrive.help', { returnObjects: true }) as unknown
  const items = Array.isArray(v) ? (v as { title: string; text: string }[]) : []
  return (
    <section className="tree-guide" aria-labelledby="my-drive-help">
      <h3 id="my-drive-help">{t('myDrive.helpTitle')}</h3>
      <ol>
        {items.map((it) => (
          <li key={it.title}>
            <strong>{it.title}</strong> — {it.text}
          </li>
        ))}
      </ol>
      <button className="btn small" onClick={onClose}>
        {t('common.close')}
      </button>
    </section>
  )
}

function DriveImport({ lib, destId: initialDest, onClose, onMine }: { lib: Library; destId: string; onClose: () => void; onMine: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const rootName = useApp((s) => s.settings.rootName)
  const [path, setPath] = useState<DriveFile[]>([])
  const [files, setFiles] = useState<DriveFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Map<string, DriveFile>>(new Map())
  const [destId, setDestId] = useState(initialDest)
  const [phase, setPhase] = useState<Phase>('browse')
  const [found, setFound] = useState(0)
  const [progress, setProgress] = useState({ done: 0, failed: 0, total: 0 })
  const [result, setResult] = useState<{ count: number; dup: number; failed: number; reason?: string } | null>(null)
  // Into the root or a category that has albums, MyMedia sorts the photos itself: sub-folders not kept by default.
  const sorts = destId === rootId || (lib.folders.get(destId)?.parentId === rootId && [...lib.folders.values()].some((f) => f.parentId === destId))
  const [keepFolders, setKeepFolders] = useState<boolean | null>(null)
  const keep = keepFolders ?? !sorts
  const here = path[path.length - 1]?.id ?? null
  // Into MyMedia itself, with the sub-folders kept: categories proposed from the folder names, checked before the copy.
  const [wantCategories, setWantCategories] = useState(false)
  const canCategorize = keep && destId === rootId
  const [pending, setPending] = useState<{ todo: DriveEntry[]; dup: number } | null>(null)
  const flat = useMemo(() => {
    const todo = pending?.todo ?? []
    // The albums wherever they are below the chosen folders (inside "My Pictures2004"…).
    const dirs = albumDirs(todo.map((e) => e.relDir))
    return todo.map((e, k) => ({ ...e, relDir: dirs[k] }))
  }, [pending])
  const proposalAlbums = useMemo<ProposalAlbum[]>(() => {
    const counts = new Map<string, number>()
    for (const e of flat) if (e.relDir.length) counts.set(e.relDir[0], (counts.get(e.relDir[0]) ?? 0) + 1)
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
  }, [flat])
  const proposal = useCategoryProposal(proposalAlbums)

  useEffect(() => {
    let alive = true
    setFiles(null)
    setError(null)
    listShared(here).then(
      (f) => alive && setFiles(f),
      (e) => alive && setError(t('errors.generic', { message: (e as Error).message })),
    )
    return () => {
      alive = false
    }
  }, [here, t])

  const toggle = (f: DriveFile) =>
    setPicked((m) => {
      const n = new Map(m)
      if (n.has(f.id)) n.delete(f.id)
      else n.set(f.id, f)
      return n
    })
  const chosen = [...picked.values()]
  const anyFolder = chosen.some(isFolder)

  async function start() {
    setPhase('collect')
    setFound(0)
    try {
      const entries = await collect(chosen, setFound)
      const dup = await markDuplicates(entries)
      const todo = entries.filter((e) => !dup.has(e.file.id))
      if (canCategorize && wantCategories) {
        setPending({ todo, dup: dup.size })
        setPhase('propose')
        return
      }
      await copy(todo, dup.size)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setPhase('browse')
    }
  }

  async function copy(todo: DriveEntry[], dup: number) {
    setPhase('copy')
    setProgress({ done: 0, failed: 0, total: todo.length })
    try {
      const r = await importFromDrive(todo, destId, keep, (done, failed) => setProgress({ done, failed, total: todo.length }))
      setResult({ count: r.count, dup, failed: r.failed, reason: r.reason })
      setPhase('done')
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setPhase('browse')
    }
  }

  /** The albums put into the categories kept, then copied. */
  function copyWithCategories() {
    const todo = flat.map((e) => {
      const category = e.relDir.length ? proposal.categoryOf(e.relDir[0]) : null
      return category ? { ...e, relDir: [category, ...e.relDir] } : e
    })
    void copy(todo, pending?.dup ?? 0)
  }

  const busy = phase === 'collect' || phase === 'copy'
  return (
    <Modal wide title={t('driveImport.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        {phase === 'browse' && (
          <>
            <div className="row" role="tablist">
              <button className="btn ghost small" role="tab" aria-selected={false} onClick={onMine}>
                <ImagePlus size={14} /> {t('myDrive.tab')}
              </button>
              <button className="btn primary small" role="tab" aria-selected>
                <Users size={14} /> {t('driveImport.shared')}
              </button>
            </div>
            <p className="hint" style={{ whiteSpace: 'pre-line' }}>{t('driveImport.hint')}</p>
            <nav className="row" aria-label={t('driveImport.where')}>
              <button className="btn ghost" onClick={() => setPath([])} disabled={!path.length}>
                {t('driveImport.shared')}
              </button>
              {path.map((p, k) => (
                <span key={p.id} className="row">
                  <ChevronRight size={14} className="flip-rtl" />
                  <button className="btn ghost" onClick={() => setPath(path.slice(0, k + 1))} disabled={k === path.length - 1}>
                    <bdi>{p.name}</bdi>
                  </button>
                </span>
              ))}
            </nav>
            <div className="folder-checklist">
              {files === null && !error && (
                <p className="hint">
                  <Loader2 size={14} className="spin" /> {t('driveImport.loading')}
                </p>
              )}
              {files?.length === 0 && <p className="hint">{here ? t('driveImport.emptyFolder') : t('driveImport.none')}</p>}
              {files?.map((f) => (
                <div key={f.id} className="check-row">
                  <label>
                    <input type="checkbox" checked={picked.has(f.id)} onChange={() => toggle(f)} />
                    {isFolder(f) ? <Folder size={16} /> : f.mimeType.startsWith('video/') ? <Video size={16} /> : f.mimeType.startsWith('image/') ? <Image size={16} /> : <FileText size={16} />}
                    <bdi>{f.name}</bdi>
                    <span className="hint">
                      {isFolder(f) ? '' : `${fmt.date(takenAtOf(f))} · ${fmt.bytes(Number(f.size ?? 0))}`}
                      {!here && f.owners?.[0]?.emailAddress ? ` · ${f.owners[0].emailAddress}` : ''}
                    </span>
                  </label>
                  {isFolder(f) && (
                    <button className="btn ghost icon" onClick={() => setPath([...path, f])} title={t('driveImport.open')} aria-label={t('driveImport.open')}>
                      <ChevronRight size={16} className="flip-rtl" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {error && <p className="error-text">{error}</p>}

            <div className="field">
              {t('driveImport.dest')}
              <FolderTreePicker categories={lib.categories} value={destId} onChange={setDestId} root={{ id: rootId, label: <bdi>{rootName}</bdi> }} />
            </div>
            {anyFolder && (
              <label className="check-row">
                <input type="checkbox" checked={keep} onChange={(e) => setKeepFolders(e.target.checked)} />
                {t('driveImport.keepFolders')}
              </label>
            )}
            {anyFolder && !keep && sorts && <p className="hint">{t('driveImport.sortHint')}</p>}
            {anyFolder && canCategorize && (
              <label className="check-row">
                <input type="checkbox" checked={wantCategories} onChange={(e) => setWantCategories(e.target.checked)} />
                {t('autoCategories.driveChoice')}
              </label>
            )}
          </>
        )}

        {phase === 'collect' && (
          <p>
            <Loader2 size={16} className="spin" /> {t('driveImport.collecting', { count: found })}
          </p>
        )}
        {phase === 'propose' &&
          (proposalAlbums.length ? (
            <CategoryProposal state={proposal} />
          ) : (
            <p className="hint">{t('autoCategories.noFolders')}</p>
          ))}
        {(phase === 'copy' || phase === 'done') && (
          <div className="import-progress" aria-live="polite">
            <strong>{t('import.progress', { done: fmt.number(progress.done + progress.failed), total: fmt.number(progress.total) })}</strong>
            <progress max={progress.total || 1} value={progress.done + progress.failed} />
          </div>
        )}
        {result && (
          <>
            <p className="ok-text">{t('driveImport.done', { count: result.count })}</p>
            {result.dup > 0 && <p className="hint">{t('driveImport.dups', { count: result.dup })}</p>}
            {result.failed > 0 && <p className="error-text">{t('driveImport.failed', { count: result.failed, reason: result.reason ?? '?' })}</p>}
          </>
        )}
      </div>
      <div className="actions">
        {phase === 'copy' && (
          <button className="btn" onClick={cancelDriveImport}>
            {t('common.cancel')}
          </button>
        )}
        {phase === 'browse' && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!chosen.length} onClick={() => void start()}>
              {t('driveImport.start', { count: chosen.length })}
            </button>
          </>
        )}
        {phase === 'propose' && (
          <>
            <button className="btn" onClick={() => setPhase('browse')}>
              {t('common.back')}
            </button>
            <button className="btn primary" onClick={copyWithCategories}>
              {t('autoCategories.copy', { count: flat.length })}
            </button>
          </>
        )}
        {phase === 'done' && (
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
    </Modal>
  )
}
