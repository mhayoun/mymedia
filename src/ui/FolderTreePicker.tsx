import type { ReactNode } from 'react'
import type { FolderInfo } from './useLibrary'

interface Props {
  categories: FolderInfo[]
  value: string | null
  onChange: (id: string) => void
  /** Folders not offered (with what they hold). */
  hidden?: ReadonlySet<string>
  /** Folder shown but not choosable (where it already is). */
  disabledId?: string
  /** First choice, above the categories (MyMedia itself). */
  root?: { id: string; label: ReactNode }
}

/** Every category and album as a tree of choices, albums shifted under their parent. */
export function FolderTreePicker({ categories, value, onChange, hidden, disabledId, root }: Props) {
  const rows: { id: string; label: ReactNode; depth: number }[] = []
  if (root) rows.push({ id: root.id, label: root.label, depth: 0 })
  const walk = (list: FolderInfo[], depth: number) => {
    for (const f of list) {
      if (hidden?.has(f.id)) continue
      rows.push({ id: f.id, label: <bdi>{f.name}</bdi>, depth })
      walk(f.children, depth + 1)
    }
  }
  walk(categories, root ? 1 : 0)
  return (
    <div className="folder-tree-picker" style={{ maxBlockSize: '50vh', overflowY: 'auto' }}>
      {rows.map((r) => (
        <label key={r.id} className="radio-row" style={{ paddingInlineStart: r.depth * 22 }}>
          <input type="radio" name="folder-tree-picker" checked={value === r.id} disabled={r.id === disabledId} onChange={() => onChange(r.id)} />
          <span>{r.label}</span>
        </label>
      ))}
    </div>
  )
}
