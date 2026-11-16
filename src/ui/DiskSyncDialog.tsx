// "Sync with the disk" (from Tree suggestion, once a folder of the computer is read): MyMedia is put back
// like the disk after its folders were renamed, photos moved between folders, folders made or removed.
// Only MyMedia changes (the disk is only read). Every change is shown first, each with its box.

import { ArrowRight, FolderSync, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { moveMedia } from '../classify/engine'
import { db, type MediaRecord } from '../db/db'
import { childrenQuery, folderNamed, FolderExistsError, listFiles } from '../drive/api'
import { useFormat } from '../i18n/format'
import { emptiedFolders, planDiskSync, type SyncMedia, type SyncPlan } from '../lib/diskSync'
import type { WalkedFile } from '../lib/importPlan'
import { FOLDER_MIME } from '../lib/media'
import { folderChain, type FolderNode } from '../lib/tree'
import { useApp } from '../store'
import { syncNow } from '../sync/engine'
import { deleteFolder, renameFolder } from '../sync/folders'
import { trashMedia } from '../sync/media'
import { markMetaDirty } from '../sync/metaStore'
import { flushMoves } from '../sync/moveQueue'
import { Modal } from './Dialog'

interface Props {
  /** The folder read: its name, where it is on the computer ('' if not known), its photos and videos. */
  diskName: string
  diskPath: string
  files: WalkedFile[]
  categoryOf: (albumName: string) => string | null
  yearFirst: boolean
  onClose: () => void
}

interface Loaded {
  plan: SyncPlan
  media: SyncMedia[]
  records: Map<string, MediaRecord>
  folders: Map<string, FolderNode>
}

/** Whether a folder or anything below it still holds a file in Drive. */
async function holdsFiles(id: string): Promise<boolean> {
  const sub: string[] = []
  let found = false
  await listFiles(childrenQuery([id]), (page) => {
    for (const f of page) {
      if (f.mimeType === FOLDER_MIME) sub.push(f.id)
      else found = true
    }
  }, undefined, 'id,mimeType')
  if (found) return true
  for (const s of sub) if (await holdsFiles(s)) return true
  return false
}

export function DiskSyncDialog({ diskName, diskPath, files, categoryOf, yearFirst, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const [data, setData] = useState<Loaded | null>(null)
  // Boxes: renames and moves by album (index in plan.albums), the files no longer on the disk, the empty folders.
  const [renames, setRenames] = useState<Set<number>>(new Set())
  const [moves, setMoves] = useState<Set<number>>(new Set())
  const [trashMissing, setTrashMissing] = useState(false)
  const [trashEmpty, setTrashEmpty] = useState(true)
  const [fixPaths, setFixPaths] = useState(true)
  const [step, setStep] = useState<{ label: string; done?: number; total?: number } | null>(null)
  const [result, setResult] = useState<{ renamed: number; moved: number; trashed: number; folders: number; paths: number; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Compared once, as the dialog opens (the proposal's function changes at each display of the window below).
  const [args] = useState(() => ({ files, categoryOf, diskName, diskPath, yearFirst }))

  useEffect(() => {
    let alive = true
    void (async () => {
      const d = db()
      const [records, metas, folderList] = await Promise.all([d.media.toArray(), d.meta.toArray(), d.folders.toArray()])
      const meta = new Map(metas.map((m) => [m.id, m]))
      const media: SyncMedia[] = records.map((r) => {
        const imported = meta.get(r.id)?.imported
        const original = Number(r.appProperties?.mymedia_original_size)
        return {
          id: r.id,
          name: r.name,
          size: r.size,
          ...(original > 0 ? { originalSize: original } : {}),
          folderId: r.folderId,
          takenAt: r.takenAt,
          imported: !!imported,
          ...(imported?.path ? { importedPath: imported.path } : {}),
          ...(imported?.from ? { importedFrom: imported.from } : {}),
        }
      })
      const folders = new Map(folderList.map((f) => [f.id, f]))
      const plan = planDiskSync({ disk: args.files, media, folders, rootId, ...args })
      if (!alive) return
      setData({ plan, media, records: new Map(records.map((r) => [r.id, r])), folders })
      setRenames(new Set(plan.albums.flatMap((a, i) => (a.renamedFrom ? [i] : []))))
      setMoves(new Set(plan.moves.map((m) => m.album)))
    })().catch((e) => setError(t('errors.generic', { message: (e as Error).message })))
    return () => {
      alive = false
    }
  }, [args, rootId, t])

  const plan = data?.plan
  /** The moves of each album of the disk. */
  const byAlbum = useMemo(() => {
    const m = new Map<number, SyncPlan['moves']>()
    for (const mv of plan?.moves ?? []) (m.get(mv.album) ?? m.set(mv.album, []).get(mv.album)!).push(mv)
    return m
  }, [plan])
  const leaving = useMemo(
    () => new Set([...(plan?.moves ?? []).filter((m) => moves.has(m.album)).map((m) => m.mediaId), ...(trashMissing ? (plan?.missing ?? []).map((m) => m.mediaId) : [])]),
    [plan, moves, trashMissing],
  )
  const emptied = useMemo(() => {
    if (!data) return []
    const kept = new Set(data.plan.albums.map((a) => a.albumId).filter((id): id is string => !!id))
    return emptiedFolders(data.media, data.folders, rootId, leaving, kept)
  }, [data, leaving, rootId])

  const pathOf = (id: string) => (data ? (folderChain(id, data.folders, rootId) ?? []).map((f) => f.name).join(' / ') : '')
  const toggle = (set: Set<number>, put: (s: Set<number>) => void, i: number) => {
    const n = new Set(set)
    if (n.has(i)) n.delete(i)
    else n.add(i)
    put(n)
  }
  const renamed = plan?.albums.map((a, i) => ({ a, i })).filter(({ a }) => a.renamedFrom) ?? []
  const moving = [...byAlbum.entries()].sort((x, y) => plan!.albums[x[0]].name.localeCompare(plan!.albums[y[0]].name))
  const nothing = !!plan && !renamed.length && !moving.length && !plan.missing.length && !emptied.length && !plan.paths.length
  const anything = (fixPaths && !!plan?.paths.length) || renames.size > 0 || [...byAlbum.keys()].some((i) => moves.has(i)) || (trashMissing && !!plan?.missing.length) || (trashEmpty && emptied.length > 0)

  async function apply() {
    if (!data || !plan) return
    setError(null)
    const errors: string[] = []
    const done = { renamed: 0, moved: 0, trashed: 0, folders: 0, paths: 0 }
    try {
      // 1. The albums renamed on the disk.
      for (const { a, i } of renamed) {
        if (!renames.has(i)) continue
        setStep({ label: t('diskSync.stepRename', { name: a.name }) })
        try {
          await renameFolder(a.albumId!, a.name)
          done.renamed++
        } catch (e) {
          errors.push(e instanceof FolderExistsError ? t('diskSync.nameTaken', { from: a.renamedFrom, name: a.name }) : `${a.renamedFrom}: ${(e as Error).message}`)
        }
      }
      // 2. The photos to their album (made if needed) and sub-folder.
      const d = db()
      const made = new Map<string, string>()
      const folderAt = async (parentId: string, name: string) => {
        const key = `${parentId}/${name.toLocaleLowerCase()}`
        let id = made.get(key)
        if (!id) {
          const f = await folderNamed(name, parentId)
          await d.folders.put({ id: f.id, name: f.name, parentId })
          id = f.id
          made.set(key, id)
        }
        return id
      }
      const list = plan.moves.filter((m) => moves.has(m.album))
      for (const [n, mv] of list.entries()) {
        setStep({ label: t('diskSync.stepMove'), done: n, total: list.length })
        const a = plan.albums[mv.album]
        try {
          let albumId = a.albumId
          if (!albumId) {
            const categoryId = a.categoryId ?? (a.categoryName ? await folderAt(rootId, a.categoryName) : rootId)
            albumId = await folderAt(categoryId, a.name)
          }
          let folderId = albumId
          for (const s of mv.sub) folderId = await folderAt(folderId, s)
          const rec = await d.media.get(mv.mediaId)
          if (rec && rec.folderId !== folderId) await moveMedia(rec, folderId, {})
          done.moved++
        } catch (e) {
          errors.push(`${mv.name}: ${(e as Error).message}`)
        }
      }
      // The moves reach Drive before anything is put in the trash.
      if (list.length) {
        setStep({ label: t('diskSync.stepDrive') })
        await flushMoves()
      }
      // The "Original folder" of the files: where they are now on the disk.
      if (fixPaths && plan.paths.length) {
        setStep({ label: t('diskSync.stepPaths') })
        const now = Date.now()
        await d.transaction('rw', d.meta, async () => {
          for (const p of plan.paths) {
            const cur = await d.meta.get(p.mediaId)
            if (!cur?.imported) continue
            await d.meta.put({ ...cur, imported: { ...cur.imported, path: p.path, from: p.from }, updatedAt: now })
            done.paths++
          }
        })
        await markMetaDirty()
      }
      // 3. The files no longer on the disk (asked).
      if (trashMissing) {
        for (const [n, m] of plan.missing.entries()) {
          setStep({ label: t('diskSync.stepTrash'), done: n, total: plan.missing.length })
          try {
            await trashMedia(m.mediaId)
            done.trashed++
          } catch (e) {
            errors.push(`${m.name}: ${(e as Error).message}`)
          }
        }
      }
      // 4. The folders left empty: only when Drive says nothing is in them any more.
      if (trashEmpty) {
        for (const id of emptied) {
          setStep({ label: t('diskSync.stepFolders') })
          try {
            if (await holdsFiles(id)) continue
            await deleteFolder(id)
            done.folders++
          } catch (e) {
            errors.push(`${data.folders.get(id)?.name ?? id}: ${(e as Error).message}`)
          }
        }
      }
    } catch (e) {
      errors.push((e as Error).message)
    }
    setStep(null)
    setResult({ ...done, errors })
    void syncNow()
  }

  return (
    <Modal title={t('diskSync.title', { name: diskName })} onClose={step ? () => undefined : onClose}>
      <p className="hint">{t('diskSync.intro')}</p>
      {!plan && !error && (
        <p>
          <Loader2 size={16} className="spin" /> {t('diskSync.comparing')}
        </p>
      )}
      {error && <p className="error-text">{error}</p>}

      {plan && !result && (
        <>
          <p>{t('diskSync.matched', { count: plan.matched, files: fmt.number(files.length) })}</p>
          {plan.notInMyMedia > 0 && <p className="hint">{t('diskSync.notInMyMedia', { count: plan.notInMyMedia })}</p>}
          {nothing && <p className="ok-text">{t('diskSync.nothing')}</p>}

          {renamed.length > 0 && (
            <section className="disk-sync-part">
              <h3>{t('diskSync.renamed', { count: renamed.length })}</h3>
              {renamed.map(({ a, i }) => (
                <label key={i} className="row">
                  <input type="checkbox" checked={renames.has(i)} disabled={!!step} onChange={() => toggle(renames, setRenames, i)} />
                  <bdi>{a.renamedFrom}</bdi> <ArrowRight size={14} className="flip-rtl" /> <bdi>{a.name}</bdi>
                  {a.categoryName && <span className="hint">({a.categoryName})</span>}
                </label>
              ))}
            </section>
          )}

          {moving.length > 0 && (
            <section className="disk-sync-part">
              <h3>{t('diskSync.moved', { count: plan.moves.length })}</h3>
              {moving.map(([i, list]) => {
                const a = plan.albums[i]
                const from = [...new Set(list.map((m) => m.from))]
                return (
                  <label key={i} className="row disk-sync-album">
                    <input type="checkbox" checked={moves.has(i)} disabled={!!step} onChange={() => toggle(moves, setMoves, i)} />
                    <span>
                      {t('diskSync.toAlbum', { count: list.length })} <strong><bdi>{[a.categoryName, a.name].filter(Boolean).join(' / ')}</bdi></strong>
                      {!a.albumId && <span className="tag auto">{t('diskSync.newAlbum')}</span>}
                      <br />
                      <span className="hint">
                        {t('diskSync.from')} <bdi>{from.slice(0, 3).join(' · ')}</bdi>
                        {from.length > 3 && ` +${from.length - 3}`}
                      </span>
                    </span>
                  </label>
                )
              })}
            </section>
          )}

          {plan.paths.length > 0 && (
            <section className="disk-sync-part">
              <h3>{t('diskSync.paths', { count: plan.paths.length })}</h3>
              <p className="hint">{t('diskSync.pathsHint')}</p>
              <details>
                <summary>{t('diskSync.showList')}</summary>
                <ul className="disk-sync-list" dir="ltr">
                  {[...new Set(plan.paths.map((p) => p.path))].slice(0, 200).map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
              <label className="row">
                <input type="checkbox" checked={fixPaths} disabled={!!step} onChange={(e) => setFixPaths(e.target.checked)} />
                {t('diskSync.fixPaths')}
              </label>
            </section>
          )}

          {plan.missing.length > 0 && (
            <section className="disk-sync-part">
              <h3>{t('diskSync.missing', { count: plan.missing.length })}</h3>
              <p className="hint">{t('diskSync.missingHint')}</p>
              <details>
                <summary>{t('diskSync.showList')}</summary>
                <ul className="disk-sync-list">
                  {plan.missing.slice(0, 300).map((m) => (
                    <li key={m.mediaId}>
                      <bdi>{m.name}</bdi> <span className="hint">· <bdi>{m.where}</bdi></span>
                    </li>
                  ))}
                </ul>
              </details>
              <label className="row">
                <input type="checkbox" checked={trashMissing} disabled={!!step} onChange={(e) => setTrashMissing(e.target.checked)} />
                {t('diskSync.trashMissing', { count: plan.missing.length })}
              </label>
            </section>
          )}

          {emptied.length > 0 && (
            <section className="disk-sync-part">
              <h3>{t('diskSync.emptied', { count: emptied.length })}</h3>
              <ul className="disk-sync-list">
                {emptied.slice(0, 100).map((id) => (
                  <li key={id}>
                    <bdi>{pathOf(id)}</bdi>
                  </li>
                ))}
              </ul>
              <label className="row">
                <input type="checkbox" checked={trashEmpty} disabled={!!step} onChange={(e) => setTrashEmpty(e.target.checked)} />
                {t('diskSync.trashEmpty')}
              </label>
            </section>
          )}

          {step && (
            <p aria-live="polite">
              <Loader2 size={16} className="spin" /> {step.label}
              {step.total ? ` ${step.done ?? 0} / ${step.total}` : ''}
            </p>
          )}
        </>
      )}

      {result && (
        <>
          <p className="ok-text">{t('diskSync.done', { renamed: result.renamed, moved: result.moved, trashed: result.trashed, folders: result.folders, paths: result.paths })}</p>
          {result.errors.length > 0 && (
            <details open>
              <summary className="error-text">{t('diskSync.errors', { count: result.errors.length })}</summary>
              <ul className="disk-sync-list">
                {result.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="actions">
        {plan && !result && !nothing && (
          <button className="btn primary" disabled={!!step || !anything} onClick={() => void apply()}>
            {step ? <Loader2 size={16} className="spin" /> : <FolderSync size={16} />} {t('diskSync.apply')}
          </button>
        )}
        <button className="btn" disabled={!!step} onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}
