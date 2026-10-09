import { FolderPlus, Inbox, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFolder } from '../drive/api'
import { useApp } from '../store'
import { syncNow } from '../sync/engine'
import type { FolderInfo, Library } from './useLibrary'

interface Props {
  lib: Library
  /** Destinations used recently, shown first. */
  recent: string[]
  nameOf: (id: string) => string
  onChoose: (folderId: string) => void
}

/** First step of "Add" from "All media": which album the photos go into. */
export function DestinationPicker({ lib, recent, nameOf, onChoose }: Props) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)!
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState(lib.categories[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    const out: { id: string; name: string; depth: number }[] = []
    const walk = (list: FolderInfo[], depth: number, parentMatches: boolean) => {
      for (const f of list) {
        const matches = parentMatches || !q || f.name.toLocaleLowerCase().includes(q)
        const before = out.length
        out.push({ id: f.id, name: f.name, depth })
        walk(f.children, depth + 1, matches && !!q)
        // Keep a folder when it or something inside it matches.
        if (!matches && out.length === before + 1) out.pop()
      }
    }
    walk(lib.categories, 0, false)
    return out
  }, [lib.categories, query])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim().replace(/\s+/g, ' ')
    if (!name || !newParent) return setError(t('folders.invalidName'))
    const existing = [...lib.folders.values()].find(
      (f) => f.parentId === newParent && f.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0,
    )
    if (existing) return onChoose(existing.id)
    setBusy(true)
    try {
      const folder = await createFolder(name, newParent)
      await syncNow()
      onChoose(folder.id)
    } catch (ex) {
      setError(t('errors.generic', { message: (ex as Error).message }))
      setBusy(false)
    }
  }

  return (
    <div className="dest-picker">
      <p>
        <strong>{t('import.whichAlbum')}</strong>
      </p>
      {recent.length > 0 && (
        <div className="chip-list">
          {recent.map((id) => (
            <button key={id} className="chip-btn" onClick={() => onChoose(id)}>
              <bdi>{nameOf(id)}</bdi>
            </button>
          ))}
        </div>
      )}

      {creating ? (
        <form className="dest-new" onSubmit={create}>
          <input type="text" dir="auto" autoFocus placeholder={t('common.name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <label className="row">
            {t('newAlbum.in')}
            <select value={newParent} onChange={(e) => setNewParent(e.target.value)}>
              {lib.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {error && <div className="error-text">{error}</div>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setCreating(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {t('common.create')}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => setCreating(true)}>
          <FolderPlus size={16} /> {t('select.newAlbum')}
        </button>
      )}

      <label className="dest-search">
        <Search size={16} />
        <input type="search" dir="auto" placeholder={t('import.searchAlbum')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="dest-list" role="list">
        {rows.map((r) => (
          <button key={r.id} role="listitem" className={r.depth === 0 ? 'category' : ''} style={{ paddingInlineStart: 10 + r.depth * 18 }} onClick={() => onChoose(r.id)}>
            <bdi>{r.name}</bdi>
          </button>
        ))}
        {rows.length === 0 && <p className="hint">{t('import.noAlbumFound')}</p>}
      </div>

      <button className="btn ghost" onClick={() => onChoose(rootId)}>
        <Inbox size={16} /> {t('import.noAlbum')}
      </button>
    </div>
  )
}
