import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parsePendingAlbum, type FolderNode } from '../lib/tree'
import { modelAlbumsToCreate } from '../models/references'
import { useApp } from '../store'
import type { FolderInfo } from './useLibrary'

interface Props {
  categories: FolderInfo[]
  /** Text of the first, empty option ("Other album…"). */
  placeholder: string
  onChoose: (folderId: string) => void
  disabled?: boolean
  exclude?: string
  /**
   * Also the albums of installed models not created yet (created when a photo
   * goes in). Only where the choice moves photos (`chooseFolder`).
   */
  withModels?: boolean
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Albums of installed models that are not in Drive yet, by category. */
function useModelAlbums(categories: FolderInfo[], enabled: boolean): Map<string, string[]> {
  const rootId = useApp((s) => s.rootId)
  const [albums, setAlbums] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    if (!enabled || !rootId) return
    const folders = new Map<string, FolderNode>()
    const walk = (list: FolderInfo[]) =>
      list.forEach((f) => {
        folders.set(f.id, { id: f.id, name: f.name, parentId: f.parentId })
        walk(f.children)
      })
    walk(categories)
    let alive = true
    modelAlbumsToCreate(folders, rootId).then(
      (m) => alive && setAlbums(m),
      (e) => console.warn('[MyMedia] model albums not read', e),
    )
    return () => {
      alive = false
    }
  }, [categories, enabled, rootId])
  return albums
}

/** Drop-down of every category and album, albums indented under their category. */
export function AlbumSelect({ categories, placeholder, onChoose, disabled, exclude, withModels }: Props) {
  const { t } = useTranslation()
  const toCreate = useModelAlbums(categories, !!withModels)
  const options = (list: FolderInfo[], depth: number): React.ReactNode[] =>
    list.flatMap((f) => [
      f.id === exclude ? null : (
        <option key={f.id} value={f.id}>
          {' '.repeat(depth)}
          {f.name}
        </option>
      ),
      ...options(f.children, depth + 1),
    ])
  // The category's albums and its model's albums still to create, in one alphabetical list.
  const albumsOf = (c: FolderInfo): React.ReactNode[] => {
    const entries: { name: string; nodes: () => React.ReactNode[] }[] = c.children.map((f) => ({ name: f.name, nodes: () => options([f], 1) }))
    for (const id of toCreate.get(c.id) ?? []) {
      const path = parsePendingAlbum(id)!.path.join(' / ')
      entries.push({
        name: path,
        nodes: () => [
          <option key={id} value={id}>
            {' '}
            {t('classify.modelAlbum', { name: path })}
          </option>,
        ],
      })
    }
    return entries.sort((a, b) => collator.compare(a.name, b.name)).flatMap((e) => e.nodes())
  }
  return (
    <select
      value=""
      disabled={disabled}
      aria-label={placeholder}
      onChange={(e) => e.target.value && onChoose(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {categories.map((c) => (
        <optgroup key={c.id} label={c.name}>
          {c.id !== exclude && <option value={c.id}>{t('classify.categoryOnly', { name: c.name })}</option>}
          {albumsOf(c)}
        </optgroup>
      ))}
    </select>
  )
}
