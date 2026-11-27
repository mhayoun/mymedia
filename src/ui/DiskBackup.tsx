// "Save to the disk" (see import/diskBackup.ts): the folder of the disk chosen, each file written there and
// checked, the fingerprints checked remembered on this device. For photos of Google Drive (a tab of "From
// Google Drive", the photos chosen shared with the import) or of MyMedia (an album, a category, a selection).

import { CheckCircle2, FolderDown, HardDrive, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { useFormat } from '../i18n/format'
import { canWalkFolders, type FsDir } from '../import/folderWalk'
import { libraryItems, recordBackups, saveItem, type BackupItem, type SaveOutcome } from '../import/diskBackup'
import { Modal } from './Dialog'
import { useLibraryContext } from './libraryContext'
import type { MediaRecord } from '../db/db'
import { useApp } from '../store'

interface Props {
  /** The files to save (null: none chosen yet). */
  items: BackupItem[]
  /** Above the disk's step (the photos chosen in Google's window). */
  before?: ReactNode
  /** Why the save cannot start yet (a name missing…), shown on the button. */
  blocked?: boolean
  onBusy?: (busy: boolean) => void
  /** After the save: go on with these files (import them into MyMedia). */
  next?: { label: string; run: () => void }
  onClose: () => void
}

export function DiskBackup({ items, before, blocked, onBusy, next, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const onDisk = canWalkFolders()
  const [disk, setDisk] = useState<FsDir | null>(null)
  const [saves, setSaves] = useState<Map<string, SaveOutcome>>(new Map())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const busy = !!progress
  useEffect(() => onBusy?.(busy), [busy, onBusy])

  const ok = (id: string) => {
    const s = saves.get(id)?.status
    return s === 'saved' || s === 'already'
  }
  const done = items.filter((i) => saves.has(i.id))
  const verified = items.filter((i) => ok(i.id))
  const failed = done.filter((i) => !ok(i.id))
  const current = verified.filter((i) => (saves.get(i.id) as { current?: boolean }).current)

  async function chooseDisk() {
    try {
      const root = await (window as unknown as { showDirectoryPicker(o: { mode: 'readwrite'; id: string }): Promise<FsDir> }).showDirectoryPicker({
        mode: 'readwrite',
        id: 'mymedia-backup',
      })
      setDisk(root)
    } catch {
      // window closed
    }
  }

  async function save() {
    if (!disk) return
    setError(null)
    const todo = items.filter((i) => !ok(i.id))
    auth.renewBefore(Math.max(10, todo.length / 20) * 60_000)
    const ctrl = (abort.current = new AbortController())
    setProgress({ done: 0, total: todo.length })
    const next = new Map(saves)
    const checked: { md5: string; path: string }[] = []
    try {
      for (const [k, item] of todo.entries()) {
        if (ctrl.signal.aborted) break
        const r = await saveItem(disk, item, ctrl.signal)
        next.set(item.id, r)
        // Only an original counts as saved (not a compressed version).
        if ((r.status === 'saved' || r.status === 'already') && r.md5 && !r.current) checked.push({ md5: r.md5, path: r.path })
        setSaves(new Map(next))
        setProgress({ done: k + 1, total: todo.length })
        if (checked.length >= 50) await recordBackups(checked.splice(0))
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(t('errors.generic', { message: (e as Error).message }))
    }
    await recordBackups(checked)
    abort.current = null
    setProgress(null)
  }

  if (!onDisk)
    return (
      <>
        <div className="modal-scroll">
          <p className="hint">{t('myDrive.noDisk')}</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </>
    )

  const finished = !busy && done.length > 0
  return (
    <>
      <div className="modal-scroll">
        {!busy && !finished && before}
        {!busy && !finished && (
          <section className="disk-sync-part">
            <h3>{t('backup.diskTitle')}</h3>
            <p className="row">
              <button className="btn small" onClick={() => void chooseDisk()}>
                <HardDrive size={14} /> {disk ? t('myDrive.diskChange') : t('myDrive.diskChoose')}
              </button>
              {disk && <span className="hint">{t('myDrive.diskChosen', { name: disk.name })}</span>}
            </p>
          </section>
        )}
        {progress && (
          <div className="import-progress" aria-live="polite">
            <strong>
              <Loader2 size={14} className="spin" /> {t('myDrive.saving', { done: fmt.number(progress.done), total: fmt.number(progress.total) })}
            </strong>
            <progress max={progress.total || 1} value={progress.done} />
          </div>
        )}
        {finished && (
          <>
            <p className={failed.length ? 'error-text' : 'ok-text'}>
              {failed.length ? <XCircle size={16} /> : <CheckCircle2 size={16} />}{' '}
              {t('myDrive.verified', { count: verified.length, total: items.length, disk: disk?.name ?? '' })}
            </p>
            {current.length > 0 && <p className="hint">{t('backup.current', { count: current.length })}</p>}
            {failed.length > 0 && (
              <>
                <p className="hint">{t('backup.failed', { count: failed.length })}</p>
                <ul className="year-disk-list">
                  {failed.slice(0, 20).map((i) => {
                    const s = saves.get(i.id)!
                    return (
                      <li key={i.id}>
                        <bdi>{i.name}</bdi> — <span className="hint">{s.status === 'mismatch' ? t('myDrive.mismatch') : (s as { reason?: string }).reason}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            <p className="hint">{t('backup.checkHint', { disk: disk?.name ?? '' })}</p>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="actions">
        {busy && (
          <button className="btn" onClick={() => abort.current?.abort()}>
            {t('common.cancel')}
          </button>
        )}
        {!busy && (
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
        {!busy && !finished && (
          <button className="btn primary" disabled={!disk || !items.length || blocked} onClick={() => void save()}>
            <FolderDown size={16} /> {t('backup.start', { count: items.length })}
          </button>
        )}
        {finished && failed.length > 0 && (
          <button className="btn" onClick={() => void save()}>
            {t('myDrive.retry', { count: failed.length })}
          </button>
        )}
        {finished && next && verified.length > 0 && (
          <button className="btn primary" onClick={next.run}>
            {next.label}
          </button>
        )}
      </div>
    </>
  )
}

/** "Save to the disk" of an album, a category or a selection of MyMedia. */
export function DiskBackupDialog({ title, recs, onClose }: { title: string; recs: MediaRecord[]; onClose: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const lib = useLibraryContext()
  const rootId = useApp((s) => s.rootId)!
  const [busy, setBusy] = useState(false)
  // The list of files is made once, as the window opens.
  const [items] = useState(() => libraryItems(recs.filter((r) => r.type !== 'document'), lib?.folders ?? new Map(), rootId))
  const size = recs.reduce((n, r) => n + (r.size || 0), 0)
  return (
    <Modal wide title={title} onClose={() => !busy && onClose()}>
      <DiskBackup
        items={items}
        onBusy={setBusy}
        onClose={onClose}
        before={
          <section className="disk-sync-part">
            <p>
              <strong>{t('backup.what', { count: items.length, size: fmt.bytes(size) })}</strong>
            </p>
            <p className="hint">{t('backup.libraryHint')}</p>
          </section>
        }
      />
    </Modal>
  )
}
