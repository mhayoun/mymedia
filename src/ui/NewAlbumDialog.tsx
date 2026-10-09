import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chooseFolder } from '../classify/engine'
import { createFolder } from '../drive/api'
import { placementOf } from '../lib/tree'
import { useApp } from '../store'
import { syncNow } from '../sync/engine'
import { Modal } from './Dialog'
import type { FolderInfo, Library } from './useLibrary'

interface Props {
  lib: Library
  /** Media to put in the new album. */
  ids: string[]
  /** Folder proposed as the parent; by default the category the media are in. */
  parentId?: string
  /** Called once the media are in the new album. */
  onDone?: () => void
  onClose: () => void
}

/** Creates an album (name + where) and moves the given media into it. */
export function NewAlbumDialog({ lib, ids, parentId, onDone, onClose }: Props) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)!
  const [name, setName] = useState('')
  const [parent, setParent] = useState(() => parentId ?? commonCategory(lib, ids, rootId) ?? lib.categories[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const parents = useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (list: FolderInfo[], depth: number) => {
      for (const f of list) {
        out.push({ id: f.id, label: ' '.repeat(depth * 2) + f.name })
        walk(f.children, depth + 1)
      }
    }
    walk(lib.categories, 0)
    return out
  }, [lib.categories])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = name.trim().replace(/\s+/g, ' ')
    if (!v || !parent) return setError(t('folders.invalidName'))
    const exists = [...lib.folders.values()].some(
      (f) => f.parentId === parent && f.name.localeCompare(v, undefined, { sensitivity: 'base' }) === 0,
    )
    if (exists) return setError(t('folders.exists'))
    setError(null)
    setProgress({ done: 0, total: ids.length })
    try {
      const folder = await createFolder(v, parent)
      await syncNow()
      for (const [n, id] of ids.entries()) {
        await chooseFolder(id, folder.id)
        setProgress({ done: n + 1, total: ids.length })
      }
      onDone?.()
      onClose()
    } catch (ex) {
      setError(t('errors.generic', { message: (ex as Error).message }))
      setProgress(null)
    }
  }

  return (
    <Modal title={t('select.newAlbumTitle', { count: ids.length })} onClose={() => !progress && onClose()}>
      <form onSubmit={submit}>
        <label className="field">
          {t('common.name')}
          <input ref={input} type="text" value={name} dir="auto" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('newAlbum.in')}
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {error && <div className="error-text">{error}</div>}
        {progress && <div className="hint">{t('select.working', progress)}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose} disabled={!!progress}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={!!progress}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** The category all the media are in, if they share one. */
function commonCategory(lib: Library, ids: string[], rootId: string): string | null {
  const byId = new Map(lib.items.map((i) => [i.rec.id, i.rec.folderId]))
  let found: string | null = null
  for (const id of ids) {
    const folderId = byId.get(id)
    const cat = folderId ? placementOf(folderId, lib.folders, rootId).categoryId : null
    if (!cat || (found && cat !== found)) return null
    found = cat
  }
  return found
}
