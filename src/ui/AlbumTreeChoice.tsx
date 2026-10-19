import { FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parsePendingAlbum } from '../lib/tree'
import { useModelAlbums } from './AlbumSelect'
import { FolderTreePicker } from './FolderTreePicker'
import type { FolderInfo } from './useLibrary'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Every category and album, with the albums of installed models not created yet (created for their first photo). */
export function useChoiceTree(categories: FolderInfo[]): FolderInfo[] {
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

/** A button that opens the tree of albums below it, in a wrapping row; a choice closes it. */
export function AlbumTreeChoice({ categories, label, onChoose, disabled, exclude }: Props) {
  const [open, setOpen] = useState(false)
  const tree = useChoiceTree(categories)
  return (
    <>
      <button className="btn ghost" disabled={disabled} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <FolderOpen size={16} /> {label}
      </button>
      {open && !disabled && (
        <div style={{ flex: '1 1 100%', order: 99 }}>
          <FolderTreePicker
            categories={tree}
            value={null}
            disabledId={exclude}
            onChange={(f) => {
              setOpen(false)
              onChoose(f)
            }}
          />
        </div>
      )}
    </>
  )
}
