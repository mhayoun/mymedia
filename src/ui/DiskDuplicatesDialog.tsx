// "Disk duplicates" (from Tree suggestion, once a folder of the computer is read with Chrome / Edge): the photos
// and videos that are in the folder twice or more, under other names, shown together; the copies ticked are
// deleted from the disk, for good, after a confirmation. MyMedia and Google Drive are not touched.

import { Copy, Film, FolderClosed, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { canWrite, fileAt, removeAt, type FsDir } from '../import/folderWalk'
import { md5Of } from '../import/importer'
import { useFormat } from '../i18n/format'
import { defaultTicks, duplicateGroups, folderPairs, pairTicks, pathKey, sameSizeFiles, type DiskCopy, type DuplicateGroup, type FolderPair } from '../lib/diskDuplicates'
import { fileKey, mediaKeys } from '../lib/diskSync'
import type { WalkedFile } from '../lib/importPlan'
import { Modal } from './Dialog'

interface Props {
  root: FsDir
  diskName: string
  files: WalkedFile[]
  /** The files deleted from the disk (the folder read is updated). */
  onDeleted: (removed: WalkedFile[]) => void
  onClose: () => void
}

/** One picture for a group (its copies are the same): the file of the disk itself, shown on this device only. */
export function LocalThumb({ file, video }: { file: File | undefined; video: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    if (!file || video) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, video])
  return (
    <span className="list-thumb dup-disk-thumb">
      {video || broken || !url ? <Film size={20} /> : <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />}
    </span>
  )
}

export function DiskDuplicatesDialog({ root, diskName, files, onDeleted, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const [checking, setChecking] = useState<{ done: number; total: number } | null>({ done: 0, total: 0 })
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [opened, setOpened] = useState<Map<string, File>>(new Map())
  const [ticks, setTicks] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ count: number; bytes: number; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Duplicates once in each of two folders: the folder kept ('a', 'b'), or chosen one by one ('each'), by pair.
  const [keep, setKeep] = useState<Map<string, 'a' | 'b' | 'each'>>(new Map())
  // Compared once, as the window opens.
  const [args] = useState(() => ({ root, files }))

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = sameSizeFiles(args.files)
        const known = mediaKeys(
          (await db().media.toArray()).map((r) => ({ name: r.name, size: r.size, originalSize: Number(r.appProperties?.mymedia_original_size) || undefined })),
        )
        const files = new Map<string, File>()
        const copies: (DiskCopy & { hash: string })[] = []
        setChecking({ done: 0, total: list.length })
        for (const [i, f] of list.entries()) {
          if (!alive) return
          try {
            const file = await fileAt(args.root, f.dirs, f.name)
            files.set(pathKey(f), file)
            copies.push({ file: f, modified: file.lastModified, inMyMedia: known.has(fileKey(f.name, f.size)), hash: `${f.size}|${await md5Of(file)}` })
          } catch {
            // A file gone since the folder was read: left out.
          }
          setChecking({ done: i + 1, total: list.length })
        }
        if (!alive) return
        const found = duplicateGroups(copies)
        setOpened(files)
        setGroups(found)
        // A pair of folders keeps all its photos in the same one: where most of the copies kept are.
        const ticked = defaultTicks(found)
        const modes = new Map<string, 'a' | 'b' | 'each'>()
        for (const p of pairsOf(found)) {
          for (const g of p.groups) for (const c of g.copies) ticked.delete(pathKey(c.file))
          for (const k of pairTicks(p, p.usual)) ticked.add(k)
          modes.set(p.key, p.usual)
        }
        setKeep(modes)
        setTicks(ticked)
      } catch (e) {
        if (alive) setError(t('errors.generic', { message: (e as Error).message }))
      }
      if (alive) setChecking(null)
    })()
    return () => {
      alive = false
    }
  }, [args, t])

  const pairs = useMemo(() => pairsOf(groups ?? []), [groups])
  // The duplicates of a pair whose folder is chosen are not listed one by one.
  const inPairs = useMemo(() => new Set(pairs.filter((p) => keep.get(p.key) !== 'each').flatMap((p) => p.groups.map((g) => g.key))), [pairs, keep])
  const listed = (groups ?? []).filter((g) => !inPairs.has(g.key))

  /** A pair's photos kept in one of its folders (the copies of the other one ticked), or chosen one by one. */
  function choose(p: FolderPair, mode: 'a' | 'b' | 'each') {
    setKeep((cur) => new Map(cur).set(p.key, mode))
    if (mode === 'each') return
    setTicks((cur) => {
      const n = new Set(cur)
      for (const g of p.groups) for (const c of g.copies) n.delete(pathKey(c.file))
      for (const k of pairTicks(p, mode)) n.add(k)
      return n
    })
  }

  const extra = useMemo(() => (groups ?? []).reduce((n, g) => n + g.copies.length - 1, 0), [groups])
  const extraBytes = useMemo(() => (groups ?? []).reduce((n, g) => n + g.size * (g.copies.length - 1), 0), [groups])
  const ticked = useMemo(() => (groups ?? []).flatMap((g) => g.copies.filter((c) => ticks.has(pathKey(c.file)))), [groups, ticks])
  const tickedBytes = ticked.reduce((n, c) => n + c.file.size, 0)
  const busy = !!checking || !!deleting

  const toggle = (key: string) =>
    setTicks((cur) => {
      const n = new Set(cur)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  /** Every copy but the one kept, in every group (also those of several albums). */
  const tickAll = () => {
    const n = new Set((groups ?? []).filter((g) => !inPairs.has(g.key)).flatMap((g) => g.copies.slice(1).map((c) => pathKey(c.file))))
    for (const p of pairs) {
      const mode = keep.get(p.key)
      if (mode === 'a' || mode === 'b') for (const k of pairTicks(p, mode)) n.add(k)
    }
    setTicks(n)
  }
  /** Nothing ticked: the pairs are then shown one by one, unticked. */
  const untickAll = () => {
    setKeep(new Map(pairs.map((p) => [p.key, 'each' as const])))
    setTicks(new Set())
  }

  async function remove() {
    setConfirming(false)
    setError(null)
    // Asked first, from the click (Chrome refuses the question after another wait).
    if (!(await canWrite(root).catch(() => false))) return setError(t('diskDuplicates.noWrite', { name: diskName }))
    const list = ticked
    // Never every copy of a photo: one stays, whatever was ticked.
    const safe = list.filter((c) => (groups ?? []).some((g) => g.copies.includes(c) && g.copies.some((o) => !ticks.has(pathKey(o.file)))))
    const removed: WalkedFile[] = []
    const errors: string[] = []
    let bytes = 0
    setDeleting({ done: 0, total: safe.length })
    for (const [i, c] of safe.entries()) {
      try {
        await removeAt(root, c.file.dirs, c.file.name)
        removed.push(c.file)
        bytes += c.file.size
      } catch (e) {
        if ((e as Error).name === 'NotFoundError') removed.push(c.file)
        else errors.push(`${pathKey(c.file)} : ${(e as Error).message}`)
      }
      setDeleting({ done: i + 1, total: safe.length })
    }
    const gone = new Set(removed.map(pathKey))
    setGroups((cur) => (cur ?? []).map((g) => ({ ...g, copies: g.copies.filter((c) => !gone.has(pathKey(c.file))) })).filter((g) => g.copies.length > 1))
    setTicks((cur) => new Set([...cur].filter((k) => !gone.has(k))))
    setDeleting(null)
    setResult({ count: removed.length, bytes, errors })
    if (removed.length) onDeleted(removed)
  }

  const date = (ms: number) => fmt.date(new Date(ms).toISOString())
  return (
    <Modal wide title={t('diskDuplicates.title', { name: diskName })} onClose={busy ? () => undefined : onClose}>
      <div className="modal-scroll">
        <p className="hint">{t('diskDuplicates.intro')}</p>
        {checking && (
          <p aria-live="polite">
            <Loader2 size={16} className="spin" /> {t('diskDuplicates.checking', { done: fmt.number(checking.done), total: fmt.number(checking.total) })}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        {result && (
          <>
            <p className="ok-text" aria-live="polite">
              {t('diskDuplicates.deleted', { count: result.count, size: fmt.bytes(result.bytes) })}
            </p>
            {result.errors.length > 0 && (
              <details>
                <summary className="error-text">{t('diskDuplicates.failed', { count: result.errors.length })}</summary>
                <ul>
                  {result.errors.map((e) => (
                    <li key={e}>
                      <bdi>{e}</bdi>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {groups && !checking && (
          <>
            {groups.length === 0 ? (
              <p className="ok-text">{t('diskDuplicates.none')}</p>
            ) : (
              <>
                <p>
                  <strong>{t('diskDuplicates.found', { count: groups.length, extra: fmt.number(extra), size: fmt.bytes(extraBytes) })}</strong>
                </p>
                <p className="hint">{t('diskDuplicates.keepHint')}</p>
                <div className="row">
                  <button className="btn small" disabled={busy} onClick={tickAll}>
                    {t('diskDuplicates.tickAll')}
                  </button>
                  <button className="btn small" disabled={busy || !ticks.size} onClick={untickAll}>
                    {t('diskDuplicates.untickAll')}
                  </button>
                </div>
                {pairs.length > 0 && <h3 className="dup-pairs-title">{t('diskDuplicates.pairsTitle')}</h3>}
                {pairs.map((p) => {
                  const mode = keep.get(p.key) ?? 'each'
                  const name = (dirs: string[]) => [diskName, ...dirs].join(' / ')
                  /** Of the copies deleted from `dirs`, those MyMedia knows by their name and size. */
                  const known = (dirs: string[]) => p.groups.filter((g) => g.copies.some((c) => c.inMyMedia && c.file.dirs.join('/') === dirs.join('/'))).length
                  return (
                    <section key={p.key} className="disk-sync-part dup-pair">
                      <div className="dup-pair-thumbs">
                        {p.groups.slice(0, 6).map((g) => (
                          <LocalThumb key={g.key} file={opened.get(pathKey(g.copies[0].file))} video={g.copies[0].file.type === 'video'} />
                        ))}
                      </div>
                      <p>
                        <strong>{t('diskDuplicates.pairText', { count: p.groups.length, size: fmt.bytes(p.bytes) })}</strong>
                      </p>
                      {(['a', 'b'] as const).map((side) => {
                        const other = side === 'a' ? p.b : p.a
                        const lost = known(other)
                        return (
                          <label key={side} className="row">
                            <input type="radio" name={p.key} checked={mode === side} disabled={busy} onChange={() => choose(p, side)} />
                            <span>
                              <FolderClosed size={14} /> {t('diskDuplicates.keepIn')} <bdi dir="auto"><strong>{name(side === 'a' ? p.a : p.b)}</strong></bdi>
                              <span className="hint">
                                {' — '}
                                {t('diskDuplicates.keepInHint', { count: p.groups.length })} <bdi dir="auto">{name(other)}</bdi>
                                {lost > 0 && <> · {t('diskDuplicates.pairKnown', { count: lost })}</>}
                              </span>
                            </span>
                          </label>
                        )
                      })}
                      <label className="row">
                        <input type="radio" name={p.key} checked={mode === 'each'} disabled={busy} onChange={() => choose(p, 'each')} />
                        <span>{t('diskDuplicates.each')}</span>
                      </label>
                    </section>
                  )
                })}
                {pairs.length > 0 && listed.length > 0 && <h3 className="dup-pairs-title">{t('diskDuplicates.othersTitle')}</h3>}
                {listed.map((g) => {
                  const left = g.copies.filter((c) => !ticks.has(pathKey(c.file))).length
                  return (
                    <section key={g.key} className="disk-sync-part dup-disk-group">
                      <LocalThumb file={opened.get(pathKey(g.copies[0].file))} video={g.copies[0].file.type === 'video'} />
                      <div>
                        <p className="hint">
                          <Copy size={14} /> {t('diskDuplicates.copies', { count: g.copies.length, size: fmt.bytes(g.size) })}
                          {g.acrossAlbums && <span className="tag warn">{t('diskDuplicates.acrossAlbums')}</span>}
                        </p>
                        {g.copies.map((c) => {
                          const key = pathKey(c.file)
                          const on = ticks.has(key)
                          return (
                            <label key={key} className="row">
                              <input type="checkbox" checked={on} disabled={busy || (!on && left <= 1)} onChange={() => toggle(key)} />
                              <span className={on ? 'dup-disk-gone' : undefined}>
                                <bdi dir="auto">{[diskName, ...c.file.dirs, c.file.name].join(' / ')}</bdi>
                              </span>
                              <span className="hint">{date(c.modified)}</span>
                              {c.inMyMedia && <span className="tag auto">{t('diskDuplicates.inMyMedia')}</span>}
                              {!on && left === 1 && <span className="tag">{t('diskDuplicates.kept')}</span>}
                            </label>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
              </>
            )}
          </>
        )}
        {deleting && (
          <div className="import-progress" aria-live="polite">
            <strong>
              <Loader2 size={14} className="spin" /> {t('diskDuplicates.deleting', { done: fmt.number(deleting.done), total: fmt.number(deleting.total) })}
            </strong>
            <progress max={deleting.total || 1} value={deleting.done} />
          </div>
        )}
        {confirming && (
          <div className="browser-warning" role="alertdialog" aria-labelledby="dup-disk-confirm">
            <p id="dup-disk-confirm">
              <strong>{t('diskDuplicates.confirmTitle', { count: ticked.length, size: fmt.bytes(tickedBytes) })}</strong>
            </p>
            <p>{t('diskDuplicates.confirmText')}</p>
            <div className="row">
              <button className="btn" onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn danger" autoFocus onClick={() => void remove()}>
                <Trash2 size={16} /> {t('diskDuplicates.confirmButton', { count: ticked.length })}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={onClose}>
          {t('common.close')}
        </button>
        {groups && groups.length > 0 && (
          <button className="btn danger" disabled={busy || confirming || !ticked.length} onClick={() => setConfirming(true)}>
            <Trash2 size={16} /> {t('diskDuplicates.delete', { count: ticked.length, size: fmt.bytes(tickedBytes) })}
          </button>
        )}
      </div>
    </Modal>
  )
}

/** Only the pairs of folders with two duplicates or more (a single one is as quick to choose in the list). */
const pairsOf = (groups: DuplicateGroup[]) => folderPairs(groups).filter((p) => p.groups.length > 1)
