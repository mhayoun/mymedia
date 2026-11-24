// "Disk years" (from Tree suggestion, once a folder of the computer is read with Chrome / Edge): in the folders
// named with their year first ("2015_Ski"), the photos and videos whose own date (EXIF, video header, name) is
// of another year. Only shown: the disk, MyMedia and Google Drive are not touched.

import { CalendarX, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fileAt, type FsDir } from '../import/folderWalk'
import { fileDate } from '../import/importer'
import { useFormat } from '../i18n/format'
import { pathKey } from '../lib/diskDuplicates'
import { filesWithYear, likelyYear, yearFolders, type YearFolder } from '../lib/diskYears'
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
            dated.push({ ...it, takenAt: d.takenAt, source: d.source })
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
        setFolders(found)
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

  return (
    <Modal wide title={t('diskYears.title', { name: diskName })} onClose={checking ? () => undefined : onClose}>
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
              return (
                <section key={key} className="disk-sync-part">
                  <h3>
                    <CalendarX size={16} /> <bdi dir="auto">{[diskName, ...f.dirs].join(' / ')}</bdi>
                  </h3>
                  <p className="hint">
                    {t('diskYears.folderWrong', { count: f.wrong.length, checked: fmt.number(f.checked), year: f.year })}
                    {likely !== null && <span className="tag warn">{t('diskYears.likely', { year: likely })}</span>}
                  </p>
                  <ul className="year-disk-list">
                    {shown.map((w) => {
                      const k = pathKey(w.file)
                      return (
                        <li key={k} className="year-disk-row">
                          <LocalThumb file={opened.get(k)} video={w.file.type === 'video'} />
                          <bdi dir="auto">{[...w.file.dirs.slice(f.dirs.length), w.file.name].join(' / ')}</bdi>
                          <span>
                            <strong>{fmt.date(w.takenAt)}</strong> <span className="hint">{source(w.source)}</span>
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
      </div>
      <div className="actions">
        <button className="btn" disabled={!!checking} onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}
