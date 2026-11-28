// Import → "From Google Drive" → "My photos in Google Drive" (see import/fromMyDrive.ts): photos chosen in
// Google's window (shared with "Save to the disk"), moved into MyMedia (no copy) and compressed (optional,
// ticked by default). Those saved and checked on the disk before do not keep their old version in Drive.

import { CheckCircle2, FolderOpen, HardDrive, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { cancelCompression, compressNow, planMany } from '../compress/engine'
import { db, type MediaRecord } from '../db/db'
import { storageQuota, type DriveQuota } from '../drive/api'
import { useFormat } from '../i18n/format'
import { backupsOf, type Backup } from '../import/diskBackup'
import { canWalkFolders } from '../import/folderWalk'
import { moveIntoMyMedia } from '../import/fromMyDrive'
import { placementOf } from '../lib/tree'
import { useApp } from '../store'
import { GroupName, PickedPhotos, sizeOf, type DrivePick } from './DrivePick'
import { FolderTreePicker } from './FolderTreePicker'
import type { Library } from './useLibrary'

type Phase = 'choose' | 'moving' | 'compressing' | 'done'

interface Props {
  pick: DrivePick
  lib: Library
  destId: string
  onDestChange: (id: string) => void
  /** "Save to the disk first": the tab that saves the same photos. */
  onBackup: () => void
  /** Tells the window above whether it may be closed. */
  onBusy: (busy: boolean) => void
  onClose: () => void
}

export function MyDriveImport({ pick, lib, destId, onDestChange, onBackup, onBusy, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const rootName = useApp((s) => s.settings.rootName)
  const compressing = useApp((s) => s.compressing)
  const [phase, setPhase] = useState<Phase>('choose')
  const [error, setError] = useState<string | null>(null)
  const [compress, setCompress] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [backups, setBackups] = useState<Map<string, Backup>>(new Map())
  const [result, setResult] = useState<{
    moved: number
    failed: number
    reason?: string
    albums: { name: string; id: string; count: number }[]
    compressed?: number
    saved?: number
    oldKept?: number
  } | null>(null)
  const [quota, setQuota] = useState<{ before?: DriveQuota; after?: DriveQuota }>({})
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    storageQuota().then((q) => setQuota({ before: q }), () => undefined)
  }, [])
  const busy = phase === 'moving' || phase === 'compressing' || pick.reading !== null
  useEffect(() => onBusy(busy), [busy, onBusy])

  /** The files to import: chosen, not already in MyMedia. */
  const todo = useMemo(
    () => pick.groups.map((g) => ({ g, files: g.files.filter((f) => !pick.dup.has(f.id)) })).filter((x) => x.files.length),
    [pick.groups, pick.dup],
  )
  const todoFiles = todo.flatMap((x) => x.files)
  // Which of them are saved and checked on the disk (from this device).
  useEffect(() => {
    let alive = true
    backupsOf(todoFiles.map((f) => f.md5Checksum)).then((b) => alive && setBackups(b))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoFiles.map((f) => f.id).join()])
  const saved = todoFiles.filter((f) => f.md5Checksum && backups.has(f.md5Checksum))
  const lastSave = [...backups.values()].map((b) => b.on).sort().pop()

  /** Every group needs its album's name (Google often does not give its folder's). */
  const unnamed = todo.filter((x) => !x.g.album.trim()).length
  const canStart = todoFiles.length > 0 && !unnamed

  /** "MyMedia / Birds / testBirds": where a folder of MyMedia is. */
  function pathOf(id: string, album = ''): string {
    const names: string[] = []
    for (let cur = lib.folders.get(id); cur && cur.id !== rootId; cur = cur.parentId ? lib.folders.get(cur.parentId) : undefined) names.unshift(cur.name)
    return [rootName, ...names, ...(album ? [album] : [])].join(' / ')
  }

  /** The album the files went to, shown (the window closes). */
  function openAlbum(id: string) {
    const target = lib.folders.has(id) ? id : destId
    const { categoryId, albumId } = target === rootId ? { categoryId: null, albumId: null } : placementOf(target, lib.folders, rootId)
    useApp.getState().setFilters({ categoryId, albumId, personId: null, provenance: null })
    onClose()
  }

  async function start() {
    setError(null)
    // A long task: the Google sign-in renewed now if it would end during it.
    auth.renewBefore(Math.max(10, todoFiles.length / 20) * 60_000)
    const ctrl = (abort.current = new AbortController())
    const savedIds = new Set(saved.map((f) => f.id))
    setPhase('moving')
    setProgress({ done: 0, total: todoFiles.length })
    try {
      const r = await moveIntoMyMedia(
        todo.map((x) => ({ album: x.g.album, files: x.files })),
        destId,
        (done, failed) => setProgress({ done: done + failed, total: todoFiles.length }),
        ctrl.signal,
        // Where each original is on the disk, told in its description.
        new Map(
          saved.map((f) => {
            const b = backups.get(f.md5Checksum!)!
            return [f.id, t('backup.note', { path: b.path, on: fmt.date(b.on) })]
          }),
        ),
      )
      abort.current = null
      let extra: { compressed?: number; saved?: number; oldKept?: number } = {}
      if (compress && r.moved.length && !ctrl.signal.aborted) {
        setPhase('compressing')
        const recs = (await db().media.bulkGet(r.moved)).filter((x): x is MediaRecord => !!x)
        const c = await compressNow(await planMany(recs, 'manual'), savedIds)
        extra = { compressed: c.count, saved: c.saved, oldKept: c.oldKept }
      }
      setResult({ moved: r.moved.length, failed: r.failed, reason: r.reason, albums: r.albums, ...extra })
      storageQuota().then((q) => setQuota((cur) => ({ ...cur, after: q })), () => undefined)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    abort.current = null
    setPhase('done')
  }

  function cancel() {
    abort.current?.abort()
    if (phase === 'compressing') cancelCompression()
  }

  return (
    <>
      <div className="modal-scroll">
        {phase === 'choose' && (
          <>
            <PickedPhotos pick={pick} count={todoFiles.length} size={sizeOf(todoFiles)}>
              {pick.dup.size > 0 && <p className="hint">{t('myDrive.dups', { count: pick.dup.size })}</p>}
            </PickedPhotos>
            {todo.length > 0 && (
              <>
                <section className="disk-sync-part">
                  <h3>{t('myDrive.savedTitle')}</h3>
                  {saved.length === todoFiles.length ? (
                    <p className="ok-text">
                      <CheckCircle2 size={16} /> {t('myDrive.allSaved', { count: saved.length, on: lastSave ? fmt.date(lastSave) : '' })}
                    </p>
                  ) : (
                    <>
                      <p className={saved.length ? 'hint' : ''}>
                        {saved.length
                          ? t('myDrive.someSaved', { count: saved.length, total: todoFiles.length })
                          : t('myDrive.noneSaved', { count: todoFiles.length })}
                      </p>
                      {canWalkFolders() && (
                        <button className="btn small" onClick={onBackup}>
                          <HardDrive size={14} /> {t('myDrive.backupFirst')}
                        </button>
                      )}
                    </>
                  )}
                </section>
                <section className="disk-sync-part">
                  <h3>{t('myDrive.whereTitle')}</h3>
                  <div className="field">
                    {t('driveImport.dest')}
                    <FolderTreePicker categories={lib.categories} value={destId} onChange={onDestChange} root={{ id: rootId, label: <bdi>{rootName}</bdi> }} />
                  </div>
                  {todo.map(({ g, files }) => (
                    <GroupName
                      key={g.key}
                      pick={pick}
                      g={g}
                      files={files}
                      label={t('myDrive.albumPlaceholder')}
                      after={g.album.trim() ? <span className="hint">{t('myDrive.goesTo', { path: pathOf(destId, g.album.trim()) })}</span> : null}
                    />
                  ))}
                  <label className="check-row">
                    <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
                    {t('myDrive.compress')}
                  </label>
                </section>
              </>
            )}
            {quota.before?.limit && (
              <p className="hint">{t('myDrive.quota', { used: fmt.bytes(quota.before.usage), total: fmt.bytes(quota.before.limit) })}</p>
            )}
          </>
        )}

        {phase === 'moving' && (
          <div className="import-progress" aria-live="polite">
            <strong>
              <Loader2 size={14} className="spin" /> {t('myDrive.moving', { done: fmt.number(progress.done), total: fmt.number(progress.total) })}
            </strong>
            <progress max={progress.total || 1} value={progress.done} />
          </div>
        )}

        {phase === 'compressing' && compressing && (
          <div className="import-progress" aria-live="polite">
            <strong>
              <Loader2 size={14} className="spin" />{' '}
              {t('myDrive.compressing', { done: fmt.number(compressing.done), total: fmt.number(compressing.total), saved: fmt.bytes(compressing.saved) })}
            </strong>
            <progress max={compressing.total || 1} value={compressing.done + compressing.fileProgress} />
          </div>
        )}

        {phase === 'done' && result && (
          <>
            <p className="ok-text">
              <CheckCircle2 size={16} /> {t('myDrive.moved', { count: result.moved })}
            </p>
            {result.albums.map((a) => (
              <p key={a.id} className="row">
                <span>{t('myDrive.movedTo', { count: a.count, path: pathOf(destId, a.name) })}</span>
                <button className="btn small" onClick={() => openAlbum(a.id)}>
                  <FolderOpen size={14} /> {t('myDrive.openAlbum')}
                </button>
              </p>
            ))}
            {result.failed > 0 && <p className="error-text">{t('myDrive.moveFailed', { count: result.failed, reason: result.reason ?? '?' })}</p>}
            {result.compressed !== undefined && (
              <p className="ok-text">{t('myDrive.compressed', { count: result.compressed, saved: fmt.bytes(result.saved ?? 0) })}</p>
            )}
            {!!result.oldKept && <p className="hint">{t('myDrive.oldKept', { count: result.oldKept })}</p>}
            {quota.before && quota.after && (
              <p className="hint">{t('myDrive.quotaAfter', { before: fmt.bytes(quota.before.usage), after: fmt.bytes(quota.after.usage) })}</p>
            )}
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="actions">
        {(phase === 'moving' || phase === 'compressing') && (
          <button className="btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
        )}
        {phase === 'choose' && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!canStart || busy} onClick={() => void start()}>
              {t(compress ? 'myDrive.startMoveCompress' : 'myDrive.startMove', { count: todoFiles.length })}
            </button>
          </>
        )}
        {phase === 'done' && (
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
    </>
  )
}
