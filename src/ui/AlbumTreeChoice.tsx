import { FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { nameKey } from '../lib/filename'
import { parsePendingAlbum } from '../lib/tree'
import { Modal } from './Dialog'
import { useModelAlbums } from './AlbumSelect'
import { FolderTreePicker } from './FolderTreePicker'
import type { FolderInfo } from './useLibrary'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Every category and album, with the albums of installed models not created yet (created for their first photo). */
function useChoiceTree(categories: FolderInfo[]): FolderInfo[] {
  const { t } = useTranslation()
  const toCreate = useModelAlbums(categories, true)
  return useMemo(
    () =>
      categories.map((c) => {
        const extra = (toCreate.get(c.id) ?? []).map((id) => ({
          id,
          name: t('classify.modelAlbum', { name: parsePendingAlbum(id)!.path.join(' / ') }),
          parentId: c.id,
          count: 0,
          children: [],
        }))
        if (!extra.length) return c
        return { ...c, children: [...c.children, ...extra].sort((a, b) => collator.compare(a.name, b.name)) }
      }),
    [categories, toCreate, t],
  )
}

interface Props {
  categories: FolderInfo[]
  label: string
  onChoose: (folderId: string) => void
  disabled?: boolean
  /** Shown but not choosable (where the photos already are). */
  exclude?: string
}

/** The folders whose name, or a sub-folder's name, contains the text. */
function filterTree(list: FolderInfo[], q: string): FolderInfo[] {
  return list.flatMap((f) => {
    if (nameKey(f.name).includes(q)) return [f]
    const children = filterTree(f.children, q)
    return children.length ? [{ ...f, children }] : []
  })
}

/** A button that opens the tree of albums in a window, with a search; a choice closes it. */
export function AlbumTreeChoice({ categories, label, onChoose, disabled, exclude }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const tree = useChoiceTree(categories)
  const q = nameKey(query.trim())
  const shown = useMemo(() => (q ? filterTree(tree, q) : tree), [tree, q])
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  return (
    <>
      <button className="btn ghost" disabled={disabled} onClick={() => setOpen(true)}>
        <FolderOpen size={16} /> {label}
      </button>
      {open && !disabled && (
        <Modal title={label} onClose={close}>
          <input
            type="search"
            dir="auto"
            autoFocus
            value={query}
            placeholder={t('classify.findAlbum')}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBlockEnd: 10 }}
          />
          {shown.length ? (
            <FolderTreePicker
              categories={shown}
              value={null}
              disabledId={exclude}
              onChange={(f) => {
                close()
                onChoose(f)
              }}
            />
          ) : (
            <p className="hint">{t('classify.noAlbumFound')}</p>
          )}
          <div className="actions">
            <button className="btn" onClick={close}>
              {t('common.cancel')}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
