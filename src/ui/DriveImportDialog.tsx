import { ChevronRight, Folder, Image, Loader2, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DriveFile } from '../drive/api'
import { useFormat } from '../i18n/format'
import { cancelDriveImport, collect, importFromDrive, isFolder, listShared, markDuplicates, takenAtOf } from '../import/fromDrive'
import { useApp } from '../store'
import { Modal } from './Dialog'
import { FolderTreePicker } from './FolderTreePicker'
import type { Library } from './useLibrary'

type Phase = 'browse' | 'collect' | 'copy' | 'done'

/** Import → "From Google Drive": files other accounts shared with this one, copied by Google into MyMedia. */
export function DriveImportDialog({ lib, destId: initialDest, onClose }: { lib: Library; destId: string; onClose: () => void }) {
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
      setPhase('copy')
      setProgress({ done: 0, failed: 0, total: todo.length })
      const r = await importFromDrive(todo, destId, keep, (done, failed) => setProgress({ done, failed, total: todo.length }))
      setResult({ count: r.count, dup: dup.size, failed: r.failed, reason: r.reason })
      setPhase('done')
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setPhase('browse')
    }
  }

  const busy = phase === 'collect' || phase === 'copy'
  return (
    <Modal wide title={t('driveImport.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        {phase === 'browse' && (
          <>
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
                    {isFolder(f) ? <Folder size={16} /> : f.mimeType.startsWith('video/') ? <Video size={16} /> : <Image size={16} />}
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
          </>
        )}

        {phase === 'collect' && (
          <p>
            <Loader2 size={16} className="spin" /> {t('driveImport.collecting', { count: found })}
          </p>
        )}
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
        {phase === 'done' && (
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
    </Modal>
  )
}
