// "Disk years" (from Tree suggestion, once a folder of the computer is read with Chrome / Edge): in the folders
// named with their year first ("2015_Ski"), the photos and videos whose own date (EXIF, video header, name) is
// of another year. A camera whose clock was wrong (its date later than the copy of the file on the disk) is told,
// and the dates of those files already in MyMedia can be put in the folder's year (same day and time; the
// date MyMedia keeps, as "Change the date" does). The disk is never touched.

import { CalendarCheck, CalendarX, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fileAt, type FsDir } from '../import/folderWalk'
import { fileDate } from '../import/importer'
import { db, type MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { changeDate, datesChanged } from '../sync/dates'
import { fileKey } from '../lib/diskSync'
import { pathKey } from '../lib/diskDuplicates'
import { clockWrong, filesWithYear, likelyYear, yearFolders, yearsTo, type YearFolder } from '../lib/diskYears'
import type { WalkedFile } from '../lib/importPlan'
import { LocalThumb } from './DiskDuplicatesDialog'
import { Modal } from './Dialog'

interface Props {
  root: FsDir
  diskName: string
  files: WalkedFile[]
  onClose: () => void
}

/** Files shown at first in a folder (all of them on a click). */
const SHOWN = 40

export function DiskYearsDialog({ root, diskName, files, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [checking, setChecking] = useState<{ done: number; total: number } | null>({ done: 0, total: 0 })
  const [folders, setFolders] = useState<YearFolder[] | null>(null)
  // The files of another year, opened (their picture is shown on this device only).
  const [opened, setOpened] = useState<Map<string, File>>(new Map())
  const [all, setAll] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // MyMedia's files by name and size (before compression too), to find the disk's files in it.
  const [library, setLibrary] = useState<Map<string, MediaRecord[]> | null>(null)
  // Folders whose files in MyMedia get the folder's year (by folder key).
  const [fix, setFix] = useState<Set<string>>(new Set())
  const [fixing, setFixing] = useState<{ done: number; total: number } | null>(null)
  const [fixed, setFixed] = useState<{ count: number; failed: number } | null>(null)
  const readOnly = useApp((s) => s.readOnly)
  // Checked once, as the window opens.
  const [args] = useState(() => ({ root, files }))

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = filesWithYear(args.files)
        const dated: Parameters<typeof yearFolders>[0] = []
        const handles = new Map<string, File>()
        setChecking({ done: 0, total: list.length })
        for (const [i, it] of list.entries()) {
          if (!alive) return
          try {
            const file = await fileAt(args.root, it.file.dirs, it.file.name)
            const d = await fileDate(file, it.file.type === 'video' ? 'video' : 'photo')
            dated.push({ ...it, takenAt: d.takenAt, source: d.source, modified: file.lastModified || undefined })
            handles.set(pathKey(it.file), file)
          } catch {
            // A file gone since the folder was read, or unreadable: left out.
          }
          setChecking({ done: i + 1, total: list.length })
        }
        if (!alive) return
        const found = yearFolders(dated)
        const wrong = new Set(found.flatMap((f) => f.wrong.map((w) => pathKey(w.file))))
        setOpened(new Map([...handles].filter(([k]) => wrong.has(k))))
        const lib = new Map<string, MediaRecord[]>()
        for (const r of await db().media.toArray()) {
          const original = Number(r.appProperties?.mymedia_original_size) || 0
          for (const k of new Set([fileKey(r.name, r.size), ...(original ? [fileKey(r.name, original)] : [])])) lib.set(k, [...(lib.get(k) ?? []), r])
        }
        if (!alive) return
        setLibrary(lib)
        setFolders(found)
        // A wrong camera clock: its folder's correction is proposed ticked.
        setFix(new Set(found.filter(clockWrong).map((f) => f.dirs.join('/'))))
      } catch (e) {
        if (alive) setError(t('errors.generic', { message: (e as Error).message }))
      }
      if (alive) setChecking(null)
    })()
    return () => {
      alive = false
    }
  }, [args, t])

  const withWrong = (folders ?? []).filter((f) => f.wrong.length)
  const wrongCount = withWrong.reduce((n, f) => n + f.wrong.length, 0)
  const checked = (folders ?? []).reduce((n, f) => n + f.checked, 0)
  const undated = (folders ?? []).reduce((n, f) => n + f.undated.length, 0)
  const source = (s: string) => t(`diskYears.source.${s}`, { defaultValue: s })

  /** By folder: its files of another year already in MyMedia, and not yet in the folder's year there. */
  const toFix = useMemo(() => {
    const m = new Map<string, MediaRecord[]>()
    if (!library) return m
    for (const f of withWrong) {
      const recs = new Map<string, MediaRecord>()
      for (const w of f.wrong)
        for (const r of library.get(fileKey(w.file.name, w.file.size)) ?? []) if (r.type !== 'document' && yearsTo(r.takenAt, f.year) !== 0) recs.set(r.id, r)
      if (recs.size) m.set(f.dirs.join('/'), [...recs.values()])
    }
    return m
  }, [library, withWrong])
  const inMyMedia = (w: { file: WalkedFile }) => !!library?.get(fileKey(w.file.name, w.file.size))?.length
  const planned = [...toFix].filter(([k]) => fix.has(k))
  const plannedCount = planned.reduce((n, [, recs]) => n + recs.length, 0)
  const busy = !!checking || !!fixing

  async function applyFix() {
    const jobs = planned.flatMap(([k, recs]) => {
      const year = withWrong.find((f) => f.dirs.join('/') === k)!.year
      return recs.map((r) => ({ r, years: yearsTo(r.takenAt, year) }))
    })
    let failed = 0
    setFixed(null)
    setFixing({ done: 0, total: jobs.length })
    for (const [i, { r, years }] of jobs.entries()) {
      try {
        if (!(await changeDate(r.id, { kind: 'shift', years, days: 0, hours: 0, minutes: 0 }))) failed++
      } catch (e) {
        console.error('[MyMedia] date not changed', r.name, e)
        failed++
      }
      setFixing({ done: i + 1, total: jobs.length })
    }
    await datesChanged()
    // The records again: what was corrected is no longer proposed.
    const done = new Map((await db().media.bulkGet(jobs.map((j) => j.r.id))).filter((r): r is MediaRecord => !!r).map((r) => [r.id, r]))
    setLibrary((cur) => (cur ? new Map([...cur].map(([k, recs]) => [k, recs.map((r) => done.get(r.id) ?? r)])) : cur))
    setFix(new Set())
    setFixing(null)
    setFixed({ count: jobs.length - failed, failed })
  }

  return (
    <Modal wide title={t('diskYears.title', { name: diskName })} onClose={busy ? () => undefined : onClose}>
      <div className="modal-scroll">
        <p className="hint">{t('diskYears.intro')}</p>
        {checking && (
          <p aria-live="polite">
            <Loader2 size={16} className="spin" /> {t('diskYears.checking', { done: fmt.number(checking.done), total: fmt.number(checking.total) })}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {folders && !checking && (
          <>
            {folders.length === 0 ? (
              <p>{t('diskYears.noFolders')}</p>
            ) : withWrong.length === 0 ? (
              <p className="ok-text">{t('diskYears.none', { count: checked, folders: fmt.number(folders.length) })}</p>
            ) : (
              <p>
                <strong>{t('diskYears.found', { count: wrongCount, folders: fmt.number(withWrong.length), checked: fmt.number(checked) })}</strong>
              </p>
            )}
            {undated > 0 && <p className="hint">{t('diskYears.undated', { count: undated })}</p>}
            {withWrong.map((f) => {
              const key = f.dirs.join('/')
              const likely = likelyYear(f)
              const shown = all.has(key) ? f.wrong : f.wrong.slice(0, SHOWN)
              const clock = clockWrong(f)
              const recs = toFix.get(key)
              return (
                <section key={key} className="disk-sync-part">
                  <h3>
                    <CalendarX size={16} /> <bdi dir="auto">{[diskName, ...f.dirs].join(' / ')}</bdi>
                  </h3>
                  <p className="hint">
                    {t('diskYears.folderWrong', { count: f.wrong.length, checked: fmt.number(f.checked), year: f.year })}
                    {likely !== null && <span className="tag warn">{t('diskYears.likely', { year: likely })}</span>}
                  </p>
                  {clock && (
                    <p className="hint">
                      <span className="tag warn">{t('diskYears.clockTag')}</span>{' '}
                      {t('diskYears.clockText', { count: f.ahead, copied: fmt.date(new Date(f.copiedOn!).toISOString()), year: f.year })}
                    </p>
                  )}
                  {recs && !readOnly && (
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={fix.has(key)}
                        disabled={busy}
                        onChange={() =>
                          setFix((cur) => {
                            const n = new Set(cur)
                            if (n.has(key)) n.delete(key)
                            else n.add(key)
                            return n
                          })
                        }
                      />
                      <span>{t('diskYears.fixFolder', { count: recs.length, year: f.year })}</span>
                    </label>
                  )}
                  <ul className="year-disk-list">
                    {shown.map((w) => {
                      const k = pathKey(w.file)
                      return (
                        <li key={k} className="year-disk-row">
                          <LocalThumb file={opened.get(k)} video={w.file.type === 'video'} />
                          <bdi dir="auto">{[...w.file.dirs.slice(f.dirs.length), w.file.name].join(' / ')}</bdi>
                          <span>
                            <strong>{fmt.date(w.takenAt)}</strong> <span className="hint">{source(w.source)}</span>
                            {inMyMedia(w) && <span className="tag auto">{t('diskDuplicates.inMyMedia')}</span>}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                  {shown.length < f.wrong.length && (
                    <button className="btn small" onClick={() => setAll((cur) => new Set(cur).add(key))}>
                      {t('diskYears.showAll', { count: f.wrong.length })}
                    </button>
                  )}
                </section>
              )
            })}
          </>
        )}
        {fixing && (
          <div className="import-progress" aria-live="polite">
            <strong>
              <Loader2 size={14} className="spin" /> {t('diskYears.fixing', { done: fmt.number(fixing.done), total: fmt.number(fixing.total) })}
            </strong>
            <progress max={fixing.total || 1} value={fixing.done} />
          </div>
        )}
        {fixed && (
          <p className={fixed.failed ? 'error-text' : 'ok-text'} aria-live="polite">
            {t('diskYears.fixed', { count: fixed.count })}
            {fixed.failed > 0 && ` ${t('dates.failed', { count: fixed.failed })}`}
          </p>
        )}
      </div>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={onClose}>
          {t('common.close')}
        </button>
        {toFix.size > 0 && !readOnly && (
          <button className="btn primary" disabled={busy || !plannedCount} onClick={() => void applyFix()}>
            <CalendarCheck size={16} /> {t('diskYears.fix', { count: plannedCount })}
          </button>
        )}
      </div>
    </Modal>
  )
}
