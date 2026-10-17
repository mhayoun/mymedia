import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { chooseFolder } from '../classify/engine'
import { useFormat } from '../i18n/format'
import { nameKey } from '../lib/filename'
import { matchesQuery } from '../lib/search'
import { parsePendingAlbum } from '../lib/tree'
import { useApp } from '../store'
import { useModelAlbums } from './AlbumSelect'
import { Modal } from './Dialog'
import { commonCategory } from './NewAlbumDialog'
import type { FolderInfo, Library } from './useLibrary'

interface Node {
  id: string
  name: string
  count: number | null
  children: Node[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Categories and albums, with the albums of installed models not created yet, in name order. */
function buildTree(categories: FolderInfo[], toCreate: Map<string, string[]>, newLabel: (name: string) => string): Node[] {
  const conv = (f: FolderInfo): Node => ({ id: f.id, name: f.name, count: f.count, children: f.children.map(conv) })
  return categories.map((c) => {
    const n = conv(c)
    for (const id of toCreate.get(c.id) ?? []) n.children.push({ id, name: newLabel(parsePendingAlbum(id)!.path.join(' / ')), count: null, children: [] })
    n.children.sort((a, b) => collator.compare(a.name, b.name))
    return n
  })
}

/** Moves the selected media into a category or album chosen in a tree (with a search). */
export function MoveMediaDialog({ lib, ids, onDone, onClose }: { lib: Library; ids: string[]; onDone: () => void; onClose: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const toCreate = useModelAlbums(lib.categories, true)
  const tree = useMemo(() => buildTree(lib.categories, toCreate, (name) => t('classify.modelAlbum', { name })), [lib.categories, toCreate, t])
  const [open, setOpen] = useState<Set<string>>(() => new Set([commonCategory(lib, ids, rootId)].filter((x): x is string => !!x)))
  const [query, setQuery] = useState('')
  const [dest, setDest] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const q = query.trim()

  // While searching: the folders whose name matches, with their parents, all open.
  const matches = (n: Node): boolean => matchesQuery(nameKey(n.name), q) || n.children.some(matches)
  const rows = (list: Node[], depth: number): ReactNode[] =>
    list.flatMap((n) => {
      if (q && !matches(n)) return []
      const isOpen = !!q || open.has(n.id)
      return [
        <div key={n.id} className="check-row" style={{ paddingInlineStart: depth * 22 }}>
          {n.children.length > 0 && !q ? (
            <button
              type="button"
              className="btn ghost icon"
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((s) => {
                  const next = new Set(s)
                  if (next.has(n.id)) next.delete(n.id)
                  else next.add(n.id)
                  return next
                })
              }
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} className="flip-rtl" />}
            </button>
          ) : (
            <span className="icon-space" />
          )}
          <label>
            <input type="radio" name="move-media" checked={dest === n.id} disabled={!!progress} onChange={() => setDest(n.id)} />
            <bdi>{depth === 0 ? <strong>{n.name}</strong> : n.name}</bdi>
            {n.count !== null && <span className="hint">({fmt.number(n.count)})</span>}
          </label>
        </div>,
        ...(isOpen ? rows(n.children, depth + 1) : []),
      ]
    })

  async function move() {
    if (!dest) return
    setError(null)
    setProgress({ done: 0, total: ids.length })
    try {
      for (const [k, id] of ids.entries()) {
        await chooseFolder(id, dest)
        setProgress({ done: k + 1, total: ids.length })
      }
      onDone()
      onClose()
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setProgress(null)
    }
  }

  const list = rows(tree, 0)
  return (
    <Modal title={t('select.moveTitle', { count: ids.length })} onClose={() => !progress && onClose()}>
      <label className="field search-field">
        <span className="row">
          <Search size={16} />
          <input type="search" dir="auto" autoFocus placeholder={t('select.moveSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
      </label>
      <div className="folder-checklist">{list.length ? list : <p className="hint">{t('select.moveNone')}</p>}</div>
      {error && <div className="error-text">{error}</div>}
      {progress && <div className="hint">{t('select.working', progress)}</div>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose} disabled={!!progress}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={!dest || !!progress} onClick={move}>
          {t('select.move')}
        </button>
      </div>
    </Modal>
  )
}
