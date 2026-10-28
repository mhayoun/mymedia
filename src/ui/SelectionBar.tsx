import { CheckSquare, FolderInput, FolderPlus, Minimize2, Pencil, RotateCcw, RotateCw, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { app, useApp } from '../store'
import { addPersonByHand, setDescription, trashMedia } from '../sync/media'
import { canRotate, rotateMedia } from '../sync/rotate'
import { CompressDialog } from './CompressDialog'
import { ConfirmDialog, PromptDialog } from './Dialog'
import { MoveMediaDialog } from './MoveMediaDialog'
import { NewAlbumDialog } from './NewAlbumDialog'
import type { Library, LibraryItem } from './useLibrary'
import type { People } from './usePeople'

type Action = 'move' | 'newAlbum' | 'description' | 'person' | 'compress' | 'delete' | null

/** Actions on the selected media (bottom bar). */
export function SelectionBar({ lib, people, items, parentId }: { lib: Library; people: People; items: LibraryItem[]; parentId: string }) {
  const { t } = useTranslation()
  const selection = useApp((s) => s.selection)
  const set = useApp((s) => s.set)
  const [action, setAction] = useState<Action>(null)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  useEffect(() => {
    if (!selection) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .viewer')) set({ selection: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, set])
  if (!selection) return null

  const ids = selection
  const selectedItems = items.filter((i) => ids.includes(i.rec.id))
  const done = () => set({ selection: null })

  /** Runs `fn` on each selected media, with progress. */
  const each = async (fn: (id: string) => Promise<unknown>, list = ids) => {
    setBusy({ done: 0, total: list.length })
    try {
      for (const [n, id] of list.entries()) {
        try {
          await fn(id)
        } catch (e) {
          console.error('[MyMedia]', e)
          app().set({ error: 'errors.syncFailed' })
        }
        setBusy({ done: n + 1, total: list.length })
      }
    } finally {
      setBusy(null)
    }
  }

  /** Turns the selected JPEG photos and MP4 / MOV videos (the others are left as they are, and counted). */
  const rotate = async (turns: 1 | -1) => {
    const list = selectedItems.filter((i) => canRotate(i.rec)).map((i) => i.rec.id)
    await each((id) => rotateMedia(id, turns), list)
    if (list.length < ids.length) app().set({ toast: { key: 'rotate.skipped', count: ids.length - list.length } })
  }

  return (
    <>
      <div className="selection-footer" role="toolbar" aria-label={t('select.title')}>
        <button className="icon-btn small" onClick={done} aria-label={t('common.close')}>
          <X size={18} />
        </button>
        <strong>{busy ? t('select.working', { done: busy.done, total: busy.total }) : t('faces.selected', { count: ids.length })}</strong>
        <button className="btn ghost" onClick={() => set({ selection: items.map((i) => i.rec.id) })} disabled={!!busy}>
          <CheckSquare size={16} /> <span className="only-desktop">{t('select.all')}</span>
        </button>
        <span className="grow" />
        {ids.length > 0 && !busy && (
          <>
            <button className="btn" onClick={() => setAction('move')} title={t('select.moveTo')}>
              <FolderInput size={16} /> <span className="only-desktop">{t('select.moveTo')}</span>
            </button>
            <button className="btn" onClick={() => setAction('newAlbum')}>
              <FolderPlus size={16} /> <span className="only-desktop">{t('select.newAlbum')}</span>
            </button>
            <button className="btn" onClick={() => setAction('description')}>
              <Pencil size={16} /> <span className="only-desktop">{t('viewer.description')}</span>
            </button>
            <button className="btn" onClick={() => setAction('person')}>
              <UserPlus size={16} /> <span className="only-desktop">{t('select.person')}</span>
            </button>
            <button className="btn" onClick={() => void rotate(-1)} title={t('rotate.left')}>
              <RotateCcw size={16} /> <span className="only-desktop">{t('rotate.left')}</span>
            </button>
            <button className="btn" onClick={() => void rotate(1)} title={t('rotate.right')}>
              <RotateCw size={16} /> <span className="only-desktop">{t('rotate.right')}</span>
            </button>
            <button className="btn" onClick={() => setAction('compress')}>
              <Minimize2 size={16} /> <span className="only-desktop">{t('compress.button')}</span>
            </button>
            <button className="btn" onClick={() => setAction('delete')}>
              <Trash2 size={16} /> <span className="only-desktop">{t('common.delete')}</span>
            </button>
          </>
        )}
      </div>

      {action === 'move' && <MoveMediaDialog lib={lib} ids={ids} onDone={done} onClose={() => setAction(null)} />}
      {action === 'newAlbum' && (
        <NewAlbumDialog
          lib={lib}
          ids={ids}
          parentId={lib.folders.has(parentId) ? parentId : undefined}
          onDone={done}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'description' && (
        <PromptDialog
          title={t('select.descriptionTitle', { count: ids.length })}
          label={t('viewer.description')}
          initial={selectedItems.length === 1 ? (selectedItems[0].meta?.description ?? '') : ''}
          onSubmit={async (text) => {
            await setDescription(ids, text)
            done()
          }}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'person' && (
        <PromptDialog
          title={t('select.personTitle', { count: ids.length })}
          label={t('faces.namePlaceholder')}
          suggestions={people.named.map((p) => p.name!)}
          onSubmit={async (name) => {
            await addPersonByHand(ids, name)
            done()
          }}
          onClose={() => setAction(null)}
        />
      )}
      {action === 'compress' && (
        <CompressDialog mode="manual" title={t('select.compressTitle', { count: ids.length })} items={selectedItems.map((i) => i.rec)} onClose={() => setAction(null)} />
      )}
      {action === 'delete' && (
        <ConfirmDialog
          title={t('select.deleteTitle', { count: ids.length })}
          text={t('viewer.deleteText')}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={async () => {
            await each((id) => trashMedia(id))
            done()
          }}
          onClose={() => setAction(null)}
        />
      )}
    </>
  )
}
