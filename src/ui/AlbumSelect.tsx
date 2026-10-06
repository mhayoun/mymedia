import { useTranslation } from 'react-i18next'
import type { FolderInfo } from './useLibrary'

interface Props {
  categories: FolderInfo[]
  /** Text of the first, empty option ("Other album…"). */
  placeholder: string
  onChoose: (folderId: string) => void
  disabled?: boolean
  exclude?: string
}

/** Drop-down of every category and album, albums indented under their category. */
export function AlbumSelect({ categories, placeholder, onChoose, disabled, exclude }: Props) {
  const { t } = useTranslation()
  const options = (list: FolderInfo[], depth: number): React.ReactNode[] =>
    list.flatMap((f) => [
      f.id === exclude ? null : (
        <option key={f.id} value={f.id}>
          {' '.repeat(depth)}
          {f.name}
        </option>
      ),
      ...options(f.children, depth + 1),
    ])
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
          {options(c.children, 1)}
        </optgroup>
      ))}
    </select>
  )
}
