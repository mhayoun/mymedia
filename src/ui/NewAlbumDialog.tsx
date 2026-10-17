import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chooseFolder } from '../classify/engine'
import { createNewFolder, FolderExistsError, sameFolderName } from '../drive/api'
import { placementOf } from '../lib/tree'
import { useApp } from '../store'
import { syncNow } from '../sync/engine'
import { Modal } from './Dialog'
import { FolderTreePicker } from './FolderTreePicker'
import type { Library } from './useLibrary'

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = name.trim().replace(/\s+/g, ' ')
    if (!v || !parent) return setError(t('folders.invalidName'))
    const exists = [...lib.folders.values()].some(
      (f) => f.parentId === parent && sameFolderName(f.name, v),
    )
    if (exists) return setError(t('folders.exists'))
    setError(null)
    setProgress({ done: 0, total: ids.length })
    try {
      const folder = await createNewFolder(v, parent)
      await syncNow()
      for (const [n, id] of ids.entries()) {
        await chooseFolder(id, folder.id)
        setProgress({ done: n + 1, total: ids.length })
      }
      onDone?.()
      onClose()
    } catch (ex) {
      setError(ex instanceof FolderExistsError ? t('folders.exists') : t('errors.generic', { message: (ex as Error).message }))
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
        <div className="field">
          {t('newAlbum.in')}
          <FolderTreePicker categories={lib.categories} value={parent} onChange={setParent} />
        </div>
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
/** The category all these media are in, or null. */
export function commonCategory(lib: Library, ids: string[], rootId: string): string | null {
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
