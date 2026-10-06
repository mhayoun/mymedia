import { CheckSquare, FolderInput, FolderPlus, Minimize2, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chooseFolder } from '../classify/engine'
import { createFolder } from '../drive/api'
import { app, useApp } from '../store'
import { syncNow } from '../sync/engine'
import { addPersonByHand, setDescription, trashMedia } from '../sync/media'
import { AlbumSelect } from './AlbumSelect'
import { CompressDialog } from './CompressDialog'
import { ConfirmDialog, PromptDialog } from './Dialog'
import type { Library, LibraryItem } from './useLibrary'
import type { People } from './usePeople'

type Action = 'newAlbum' | 'description' | 'person' | 'compress' | 'delete' | null

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
  const each = async (fn: (id: string) => Promise<unknown>) => {
    setBusy({ done: 0, total: ids.length })
    try {
      for (const [n, id] of ids.entries()) {
        try {
          await fn(id)
        } catch (e) {
          console.error('[MyMedia]', e)
          app().set({ error: 'errors.syncFailed' })
        }
        setBusy({ done: n + 1, total: ids.length })
      }
    } finally {
      setBusy(null)
    }
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
            <label className="row" title={t('select.moveTo')}>
              <FolderInput size={16} />
              <AlbumSelect categories={lib.categories} placeholder={t('select.moveTo')} onChoose={(f) => each((id) => chooseFolder(id, f)).then(done)} />
            </label>
            <button className="btn" onClick={() => setAction('newAlbum')}>
              <FolderPlus size={16} /> <span className="only-desktop">{t('select.newAlbum')}</span>
            </button>
            <button className="btn" onClick={() => setAction('description')}>
              <Pencil size={16} /> <span className="only-desktop">{t('viewer.description')}</span>
            </button>
            <button className="btn" onClick={() => setAction('person')}>
              <UserPlus size={16} /> <span className="only-desktop">{t('select.person')}</span>
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

      {action === 'newAlbum' && (
        <PromptDialog
          title={t('select.newAlbumTitle', { count: ids.length })}
          confirmLabel={t('common.create')}
          onSubmit={async (name) => {
            const folder = await createFolder(name, parentId)
            await syncNow()
            await each((id) => chooseFolder(id, folder.id))
            done()
          }}
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
