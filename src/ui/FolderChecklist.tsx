import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { FolderInfo } from './useLibrary'

interface Props {
  categories: FolderInfo[]
  checked: ReadonlySet<string>
  onChange: (checked: Set<string>) => void
  disabled?: boolean
  /** First box, above the categories: everything (MyMedia itself); it covers all the others. */
  root?: { id: string; label: ReactNode }
  /** Text after each name, e.g. its number of photos. */
  extra?: (f: FolderInfo) => ReactNode
  /** The folders shown open at first (e.g. all of them: "Expand all"). */
  initialOpen?: Iterable<string>
  /** The first box opens and closes like a folder (its categories hidden until opened; open: `initialOpen` has its id). */
  collapsibleRoot?: boolean
}

/**
 * Categories and albums with a box each; a category opens to show its albums.
 * A ticked folder takes all it holds, so the boxes below it show ticked.
 */
export function FolderChecklist({ categories, checked, onChange, disabled, root, extra, initialOpen, collapsibleRoot = false }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen))
  const all = !!root && checked.has(root.id)
  const rootOpen = !collapsibleRoot || (!!root && open.has(root.id))
  const toggle = (id: string) => {
    const n = new Set(checked)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    onChange(n)
  }
  const rows = (list: FolderInfo[], depth: number, covered: boolean): ReactNode[] =>
    list.flatMap((f) => {
      const on = covered || checked.has(f.id)
      const isOpen = open.has(f.id)
      return [
        <div key={f.id} className="check-row" style={{ paddingInlineStart: depth * 22 }}>
          {f.children.length > 0 ? (
            <button
              type="button"
              className="btn ghost icon"
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((s) => {
                  const n = new Set(s)
                  if (n.has(f.id)) n.delete(f.id)
                  else n.add(f.id)
                  return n
                })
              }
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} className="flip-rtl" />}
            </button>
          ) : (
            <span className="icon-space" />
          )}
          <label>
            <input type="checkbox" checked={on} disabled={disabled || covered} onChange={() => toggle(f.id)} />
            <bdi>{f.name}</bdi> {extra?.(f)}
          </label>
        </div>,
        ...(isOpen ? rows(f.children, depth + 1, on) : []),
      ]
    })
  return (
    <div className="folder-checklist">
      {root && (
        <div className="check-row">
          {collapsibleRoot && (
            <button
              type="button"
              className="btn ghost icon"
              aria-expanded={rootOpen}
              onClick={() =>
                setOpen((s) => {
                  const n = new Set(s)
                  if (n.has(root.id)) n.delete(root.id)
                  else n.add(root.id)
                  return n
                })
              }
            >
              {rootOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} className="flip-rtl" />}
            </button>
          )}
          <label>
            <input type="checkbox" checked={all} disabled={disabled} onChange={() => toggle(root.id)} />
            <strong>{root.label}</strong>
          </label>
        </div>
      )}
      {rootOpen && rows(categories, collapsibleRoot ? 1 : 0, all)}
    </div>
  )
}
