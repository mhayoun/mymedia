// Import → "From Google Drive" → "My photos in Google Drive" (see import/fromMyDrive.ts): photos chosen in
// Google's window; their originals saved on the computer's disk and checked (optional, ticked by default);
// then moved into MyMedia (no copy) and compressed (optional, ticked by default).

import { CheckCircle2, FolderDown, HardDrive, ImagePlus, Loader2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { cancelCompression, compressNow, planMany } from '../compress/engine'
import { loadConfig } from '../config'
import { db, type MediaRecord } from '../db/db'
import { storageQuota, type DriveFile, type DriveQuota } from '../drive/api'
import { loadPicker, pickMyDriveMedia } from '../drive/picker'
import { useFormat } from '../i18n/format'
import { canWalkFolders, type FsDir } from '../import/folderWalk'
import { markDuplicates } from '../import/fromDrive'
import { describePicked, entriesOf, moveIntoMyMedia, saveOriginal, type PickedGroup, type SaveOutcome } from '../import/fromMyDrive'
import { useApp } from '../store'
import { FolderTreePicker } from './FolderTreePicker'
import type { Library } from './useLibrary'

type Phase = 'choose' | 'reading' | 'saving' | 'checked' | 'moving' | 'compressing' | 'done'
type Group = PickedGroup & { album: string }

interface Props {
  lib: Library
  destId: string
  onDestChange: (id: string) => void
  /** Tells the window above whether it may be closed. */
  onBusy: (busy: boolean) => void
  onClose: () => void
}

const sizeOf = (files: DriveFile[]) => files.reduce((n, f) => n + Number(f.size ?? 0), 0)

export function MyDriveImport({ lib, destId, onDestChange, onBusy, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const rootName = useApp((s) => s.settings.rootName)
  const compressing = useApp((s) => s.compressing)
  const [phase, setPhase] = useState<Phase>('choose')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [dup, setDup] = useState<Set<string>>(new Set())
  const [reading, setReading] = useState(0)
  const [unreadable, setUnreadable] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const onDisk = canWalkFolders()
  const [backup, setBackup] = useState(onDisk)
  const [disk, setDisk] = useState<FsDir | null>(null)
  const [compress, setCompress] = useState(true)
  const [saves, setSaves] = useState<Map<string, SaveOutcome>>(new Map())
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<{ moved: number; failed: number; reason?: string; compressed?: number; saved?: number; oldKept?: number } | null>(null)
  const [quota, setQuota] = useState<{ before?: DriveQuota; after?: DriveQuota }>({})
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    void loadPicker().catch(() => undefined)
    loadConfig().then((c) => setApiKey(c.googleApiKey ?? ''))
    storageQuota().then((q) => setQuota({ before: q }), () => undefined)
  }, [])
  const busy = phase === 'reading' || phase === 'saving' || phase === 'moving' || phase === 'compressing'
  useEffect(() => onBusy(busy), [busy, onBusy])

  /** The files to import: chosen, not already in MyMedia. */
  const todo = useMemo(() => groups.map((g) => ({ ...g, files: g.files.filter((f) => !dup.has(f.id)) })).filter((g) => g.files.length), [groups, dup])
  const todoFiles = todo.flatMap((g) => g.files)
  const verified = todoFiles.filter((f) => {
    const s = saves.get(f.id)?.status
    return s === 'saved' || s === 'already'
  })
  const notVerified = todoFiles.filter((f) => !verified.includes(f))

  async function pick() {
    setError(null)
    if (!apiKey) return setError(t('myDrive.noKey'))
    try {
      const picked = await pickMyDriveMedia(apiKey, { locale: i18n.language, title: t('myDrive.pickerTitle') })
      if (!picked?.length) return
      setPhase('reading')
      setReading(0)
      const known = new Set(groups.flatMap((g) => g.files.map((f) => f.id)))
      const { groups: more, unreadable: bad } = await describePicked(
        picked.filter((p) => !known.has(p.id)),
        setReading,
      )
      setUnreadable((n) => n + bad)
      const merged: Group[] = groups.map((g) => ({ ...g }))
      for (const g of more) {
        const same = merged.find((m) => m.key === g.key)
        if (same) same.files = [...same.files, ...g.files]
        else merged.push({ ...g, album: g.folderName ?? '' })
      }
      setGroups(merged)
      setDup(await markDuplicates(entriesOf(merged)))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    setPhase('choose')
  }

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

  /** The folder of the disk a group's originals go in. */
  const dirOf = (g: Group) => g.album.trim() || g.folderName || 'Google Drive'

  async function start() {
    setError(null)
    // A long task: the Google sign-in renewed now if it would end during it.
    auth.renewBefore(Math.max(10, todoFiles.length / 20) * 60_000)
    if (backup && disk) await saveAll()
    else await moveAll(todoFiles.map((f) => f.id), new Set())
  }

  async function saveAll() {
    const ctrl = (abort.current = new AbortController())
    setPhase('saving')
    const files = todo.flatMap((g) => g.files.map((f) => ({ g, f }))).filter(({ f }) => {
      const s = saves.get(f.id)?.status
      return s !== 'saved' && s !== 'already'
    })
    setProgress({ done: 0, total: files.length })
    const next = new Map(saves)
    try {
      for (const [i, { g, f }] of files.entries()) {
        if (ctrl.signal.aborted) break
        next.set(f.id, await saveOriginal(disk!, dirOf(g), f, ctrl.signal))
        setSaves(new Map(next))
        setProgress({ done: i + 1, total: files.length })
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(t('errors.generic', { message: (e as Error).message }))
    }
    abort.current = null
    setPhase('checked')
  }

  async function moveAll(ids: string[], saved: Set<string>) {
    const ctrl = (abort.current = new AbortController())
    const only = new Set(ids)
    const parts = todo.map((g) => ({ album: g.album, files: g.files.filter((f) => only.has(f.id)) })).filter((g) => g.files.length)
    setPhase('moving')
    setProgress({ done: 0, total: ids.length })
    try {
      const r = await moveIntoMyMedia(parts, destId, (done, failed) => setProgress({ done: done + failed, total: ids.length }), ctrl.signal)
      abort.current = null
      let extra: { compressed?: number; saved?: number; oldKept?: number } = {}
      if (compress && r.moved.length && !ctrl.signal.aborted) {
        setPhase('compressing')
        const recs = (await db().media.bulkGet(r.moved)).filter((x): x is MediaRecord => !!x)
        const c = await compressNow(await planMany(recs, 'manual'), saved)
        extra = { compressed: c.count, saved: c.saved, oldKept: c.oldKept }
      }
      setResult({ moved: r.moved.length, failed: r.failed, reason: r.reason, ...extra })
      storageQuota().then((q) => setQuota((cur) => ({ ...cur, after: q })), () => undefined)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    abort.current = null
    setPhase('done')
  }

  function transfer() {
    auth.renewBefore(Math.max(10, verified.length / 20) * 60_000)
    void moveAll(
      verified.map((f) => f.id),
      new Set(verified.map((f) => f.id)),
    )
  }

  function cancel() {
    abort.current?.abort()
    if (phase === 'compressing') cancelCompression()
  }

  const canStart = todoFiles.length > 0 && (!backup || !!disk)
  const failedSaves = todoFiles.filter((f) => {
    const s = saves.get(f.id)?.status
    return s === 'mismatch' || s === 'error'
  })

  return (
    <>
      <div className="modal-scroll">
        {phase === 'choose' && (
          <>
            <p className="hint" style={{ whiteSpace: 'pre-line' }}>{t('myDrive.intro')}</p>
            <button className="btn" onClick={() => void pick()} disabled={apiKey === null}>
              <ImagePlus size={16} /> {groups.length ? t('myDrive.pickMore') : t('myDrive.pick')}
            </button>
            {unreadable > 0 && <p className="error-text">{t('myDrive.unreadable', { count: unreadable })}</p>}
            {groups.length > 0 && (
              <>
                <p>
                  <strong>{t('myDrive.chosen', { count: todoFiles.length, size: fmt.bytes(sizeOf(todoFiles)) })}</strong>
                </p>
                {dup.size > 0 && <p className="hint">{t('myDrive.dups', { count: dup.size })}</p>}
                {todo.map((g) => (
                  <div key={g.key} className="field">
                    <span>
                      {g.folderName ? t('myDrive.fromFolder', { name: g.folderName }) : t('myDrive.fromUnknown')} ·{' '}
                      {t('myDrive.files', { count: g.files.length, size: fmt.bytes(sizeOf(g.files)) })}
                    </span>
                    <input
                      value={g.album}
                      placeholder={t('myDrive.albumPlaceholder')}
                      aria-label={t('myDrive.album')}
                      onChange={(e) => setGroups((cur) => cur.map((x) => (x.key === g.key ? { ...x, album: e.target.value } : x)))}
                    />
                  </div>
                ))}
                <div className="field">
                  {t('driveImport.dest')}
                  <FolderTreePicker categories={lib.categories} value={destId} onChange={onDestChange} root={{ id: rootId, label: <bdi>{rootName}</bdi> }} />
                </div>
                {onDisk ? (
                  <>
                    <label className="check-row">
                      <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
                      {t('myDrive.backup')}
                    </label>
                    {backup && (
                      <p className="row">
                        <button className="btn small" onClick={() => void chooseDisk()}>
                          <HardDrive size={14} /> {disk ? t('myDrive.diskChange') : t('myDrive.diskChoose')}
                        </button>
                        {disk && (
                          <span className="hint">
                            {t('myDrive.diskChosen', { name: disk.name })}
                          </span>
                        )}
                      </p>
                    )}
                    {backup && <p className="hint">{t('myDrive.backupHint')}</p>}
                    {!backup && <p className="hint">{t('myDrive.noBackupHint')}</p>}
                  </>
                ) : (
                  <p className="hint">{t('myDrive.noDisk')}</p>
                )}
                <label className="check-row">
                  <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
                  {t('myDrive.compress')}
                </label>
              </>
            )}
            {quota.before?.limit && (
              <p className="hint">{t('myDrive.quota', { used: fmt.bytes(quota.before.usage), total: fmt.bytes(quota.before.limit) })}</p>
            )}
          </>
        )}

        {phase === 'reading' && (
          <p aria-live="polite">
            <Loader2 size={16} className="spin" /> {t('myDrive.reading', { count: reading })}
          </p>
        )}

        {(phase === 'saving' || phase === 'moving') && (
          <div className="import-progress" aria-live="polite">
            <strong>
              <Loader2 size={14} className="spin" />{' '}
              {t(phase === 'saving' ? 'myDrive.saving' : 'myDrive.moving', { done: fmt.number(progress.done), total: fmt.number(progress.total) })}
            </strong>
            <progress max={progress.total || 1} value={progress.done} />
          </div>
        )}

        {phase === 'checked' && (
          <>
            <p className={notVerified.length ? 'error-text' : 'ok-text'}>
              {notVerified.length ? <XCircle size={16} /> : <CheckCircle2 size={16} />}{' '}
              {t('myDrive.verified', { count: verified.length, total: todoFiles.length, disk: disk?.name ?? '' })}
            </p>
            {failedSaves.length > 0 && (
              <>
                <p className="hint">{t('myDrive.notVerified', { count: failedSaves.length })}</p>
                <ul className="year-disk-list">
                  {failedSaves.slice(0, 20).map((f) => {
                    const s = saves.get(f.id)!
                    return (
                      <li key={f.id}>
                        <bdi>{f.name}</bdi> — <span className="hint">{s.status === 'mismatch' ? t('myDrive.mismatch') : (s as { reason?: string }).reason}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            <p className="hint">{t('myDrive.checkHint', { disk: disk?.name ?? '' })}</p>
          </>
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
        {busy && phase !== 'reading' && (
          <button className="btn" onClick={cancel}>
            {t('common.cancel')}
          </button>
        )}
        {phase === 'choose' && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!canStart} onClick={() => void start()}>
              {backup && onDisk ? <FolderDown size={16} /> : null} {t(backup && onDisk ? 'myDrive.startSave' : 'myDrive.startMove', { count: todoFiles.length })}
            </button>
          </>
        )}
        {phase === 'checked' && (
          <>
            {failedSaves.length > 0 && (
              <button className="btn" onClick={() => void saveAll()}>
                {t('myDrive.retry', { count: failedSaves.length })}
              </button>
            )}
            <button className="btn" onClick={onClose}>
              {t('myDrive.stopHere')}
            </button>
            <button className="btn primary" disabled={!verified.length} onClick={transfer}>
              {t(compress ? 'myDrive.transferCompress' : 'myDrive.transfer', { count: verified.length })}
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
