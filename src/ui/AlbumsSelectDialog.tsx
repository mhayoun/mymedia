import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { subtreeIds } from '../lib/tree'
import { useApp } from '../store'
import { deleteFolders, moveFolders } from '../sync/folders'
import { Modal } from './Dialog'
import { FolderTreePicker } from './FolderTreePicker'
import type { FolderInfo, Library } from './useLibrary'

interface Props {
  lib: Library
  /** The category (or album) whose albums are chosen. */
  parent: FolderInfo
  onClose: () => void
}

type Step = 'pick' | 'move' | 'delete'

/** Several albums of a category ticked at once, then moved into another folder or put in the trash. */
export function AlbumsSelectDialog({ lib, parent, onClose }: Props) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)!
  const rootName = useApp((s) => s.settings.rootName)
  const albums = parent.children
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<Step>('pick')
  const [dest, setDest] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chosen = albums.filter((a) => checked.has(a.id))
  const files = chosen.reduce((n, a) => n + a.count, 0)
  // Not into one of the chosen albums (or what they hold).
  const inside = useMemo(() => {
    const ids = new Set<string>()
    for (const a of chosen) for (const id of subtreeIds(a.id, lib.folders.values())) ids.add(id)
    return ids
  }, [chosen, lib.folders])
  const destName = dest && dest !== rootId ? lib.folders.get(dest)?.name : undefined

  const flip = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const all = checked.size === albums.length && albums.length > 0

  async function move() {
    if (!dest) return
    setError(null)
    const r = await moveFolders([...checked], dest, (done, total) => setProgress({ done, total }))
    setProgress(null)
    if (!r.taken.length && !r.failed.length) return onClose()
    setChecked(new Set(chosen.filter((a) => r.taken.includes(a.name) || r.failed.includes(a.name)).map((a) => a.id)))
    setError(
      [
        r.taken.length ? t('albumsSelect.taken', { names: r.taken.join(', ') }) : '',
        r.failed.length ? t('albumsSelect.failed', { names: r.failed.join(', ') }) : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  async function remove() {
    setError(null)
    const r = await deleteFolders([...checked], (done, total) => setProgress({ done, total }))
    setProgress(null)
    if (!r.failed.length) return onClose()
    setChecked(new Set(chosen.filter((a) => r.failed.includes(a.name)).map((a) => a.id)))
    setError(t('albumsSelect.failed', { names: r.failed.join(', ') }))
  }

  const busy = !!progress
  return (
    <Modal title={t('albumsSelect.title', { name: parent.name })} onClose={busy ? () => {} : onClose}>
      {step === 'pick' && (
        <>
          <div className="folder-checklist">
            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={all}
                  onChange={() => setChecked(all ? new Set() : new Set(albums.map((a) => a.id)))}
                />
                <strong>{t('albumsSelect.all', { count: albums.length })}</strong>
              </label>
            </div>
            {albums.map((a) => (
              <div className="check-row" key={a.id}>
                <label>
                  <input type="checkbox" checked={checked.has(a.id)} onChange={() => flip(a.id)} />
                  <bdi>{a.name}</bdi>
                  <span className="hint">({a.count})</span>
                </label>
              </div>
            ))}
          </div>
          <p className="hint">{t('albumsSelect.chosen', { count: checked.size, files })}</p>
        </>
      )}
      {step === 'move' && (
        <>
          <p>{t('albumsSelect.moveIntro', { count: checked.size })}</p>
          <FolderTreePicker
            categories={lib.categories}
            value={dest}
            onChange={setDest}
            hidden={inside}
            disabledId={parent.id}
            root={{ id: rootId, label: <><bdi>{rootName}</bdi> <span className="hint">{t('albumsSelect.moveRootHint')}</span></> }}
          />
          {dest && (
            <p className="hint">
              {dest === rootId ? t('albumsSelect.asCategories') : t('albumsSelect.asAlbums', { dest: destName })}{' '}
              {t('albumsSelect.moveWith', { count: files })}
            </p>
          )}
        </>
      )}
      {step === 'delete' && <p>{t('albumsSelect.deleteText', { count: checked.size, files })}</p>}
      {progress && <p className="hint">{t('albumsSelect.progress', progress)}</p>}
      {error && <div className="error-text">{error}</div>}
      <div className="actions">
        {step === 'pick' ? (
          <>
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn danger" disabled={!checked.size} onClick={() => setStep('delete')}>
              {t('common.delete')}
            </button>
            <button type="button" className="btn primary" disabled={!checked.size} onClick={() => setStep('move')}>
              {t('folders.move')}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => (setError(null), setStep('pick'))}>
              {t('albumsSelect.back')}
            </button>
            {step === 'move' ? (
              <button type="button" className="btn primary" disabled={busy || !dest || !checked.size} onClick={move}>
                {t('albumsSelect.moveButton', { count: checked.size })}
              </button>
            ) : (
              <button type="button" className="btn danger" disabled={busy || !checked.size} onClick={remove}>
                {t('albumsSelect.deleteButton', { count: checked.size })}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
