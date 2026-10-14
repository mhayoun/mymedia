import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderExistsError } from '../drive/api'
import { folderChain, subtreeIds } from '../lib/tree'
import { useApp } from '../store'
import { moveFolder } from '../sync/folders'
import { Modal } from './Dialog'
import type { FolderInfo, Library } from './useLibrary'

interface Props {
  lib: Library
  id: string
  name: string
  /** Files in the folder and its albums. */
  count: number
  onClose: () => void
}

/** Moves a category or album into MyMedia (a category) or into another folder (an album of it). */
export function MoveFolderDialog({ lib, id, name, count, onClose }: Props) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)!
  const rootName = useApp((s) => s.settings.rootName)
  const setFilters = useApp((s) => s.setFilters)
  const parentId = lib.folders.get(id)?.parentId
  const inside = useMemo(() => subtreeIds(id, lib.folders.values()), [id, lib.folders])
  const [dest, setDest] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every folder it can go into: not itself, not what it holds, not where it already is.
  const choices: { id: string; name: string; depth: number }[] = []
  const walk = (list: FolderInfo[], depth: number) => {
    for (const f of list) {
      if (inside.has(f.id)) continue
      choices.push({ id: f.id, name: f.name, depth })
      walk(f.children, depth + 1)
    }
  }
  walk(lib.categories, 1)

  const destName = dest && dest !== rootId ? lib.folders.get(dest)?.name : undefined

  async function move() {
    if (!dest) return
    setBusy(true)
    try {
      await moveFolder(id, dest)
      // Keep showing the moved folder, at its new place.
      const top = dest === rootId ? null : folderChain(dest, lib.folders, rootId)?.[0]?.id
      setFilters(top ? { categoryId: top, albumId: id } : { categoryId: id, albumId: null })
      onClose()
    } catch (ex) {
      setError(ex instanceof FolderExistsError ? t('folders.exists') : t('errors.generic', { message: (ex as Error).message }))
      setBusy(false)
    }
  }

  const option = (value: string, label: React.ReactNode, depth: number) => (
    <label key={value} className="radio-row" style={{ paddingInlineStart: depth * 22 }}>
      <input type="radio" name="move-dest" checked={dest === value} disabled={value === parentId} onChange={() => setDest(value)} />
      <span>{label}</span>
    </label>
  )

  return (
    <Modal title={t('folders.moveTitle', { name })} onClose={onClose}>
      <div className="move-list" style={{ maxBlockSize: '50vh', overflowY: 'auto' }}>
        {option(rootId, <><bdi>{rootName}</bdi> <span className="hint">{t('folders.moveRootHint')}</span></>, 0)}
        {choices.map((c) => option(c.id, <bdi>{c.name}</bdi>, c.depth))}
      </div>
      {dest && (
        <p className="hint">
          {dest === rootId ? t('folders.moveAsCategory') : t('folders.moveAsAlbum', { dest: destName })} {t('folders.moveWith', { count })}
        </p>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={busy || !dest} onClick={move}>
          {t('folders.move')}
        </button>
      </div>
    </Modal>
  )
}
