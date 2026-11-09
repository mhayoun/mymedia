import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
  /** Every folder open (e.g. the result of a search), without the open / close buttons. */
  expandAll?: boolean
}

/** The folders on the way to `id` (its parents), so the chosen one is visible when the tree opens. */
function pathTo(list: FolderInfo[], id: string | null | undefined): string[] {
  if (!id) return []
  for (const f of list) {
    if (f.id === id) return []
    const sub = pathTo(f.children, id)
    if (sub.length || f.children.some((c) => c.id === id)) return [f.id, ...sub]
  }
  return []
}

/**
 * Every category and album as a tree of choices, albums shifted under their parent.
 * A folder with sub-folders opens and closes (▸ / ▾); all closed at first, except the way to the
 * chosen folder and to the one where it already is.
 */
export function FolderTreePicker({ categories, value, onChange, hidden, disabledId, root, expandAll = false }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([...pathTo(categories, value), ...pathTo(categories, disabledId)]))
  const flip = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const rows = (list: FolderInfo[], depth: number): ReactNode[] =>
    list.flatMap((f) => {
      if (hidden?.has(f.id)) return []
      const subs = f.children.filter((c) => !hidden?.has(c.id))
      const isOpen = expandAll || open.has(f.id)
      return [
        <div key={f.id} className="check-row" style={{ paddingInlineStart: depth * 22 }}>
          {subs.length > 0 && !expandAll ? (
            <button type="button" className="btn ghost icon" aria-expanded={isOpen} onClick={() => flip(f.id)}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} className="flip-rtl" />}
            </button>
          ) : (
            <span className="icon-space" />
          )}
          <label>
            <input type="radio" name="folder-tree-picker" checked={value === f.id} disabled={f.id === disabledId} onChange={() => onChange(f.id)} />
            <bdi>{depth === (root ? 1 : 0) ? <strong>{f.name}</strong> : f.name}</bdi>
          </label>
        </div>,
        ...(isOpen ? rows(subs, depth + 1) : []),
      ]
    })
  return (
    <div className="folder-tree-picker folder-checklist">
      {root && (
        <div className="check-row">
          <span className="icon-space" />
          <label>
            <input type="radio" name="folder-tree-picker" checked={value === root.id} disabled={root.id === disabledId} onChange={() => onChange(root.id)} />
            <span>{root.label}</span>
          </label>
        </div>
      )}
      {rows(categories, root ? 1 : 0)}
    </div>
  )
}
