import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ORIGINS, type Origin } from '../lib/media'
import type { CompressionState } from '../lib/search'
import { useApp, type Filters } from '../store'
import type { People } from './usePeople'

type Status = NonNullable<Filters['status']>
const STATUSES: Status[] = ['classified', 'toClassify', 'toCheck', 'auto']
const COMPRESSIONS: CompressionState[] = ['compressed', 'already', 'not']

/** Search box + extra filters (origin, classification, compression, person), with removable chips. */
export function FilterBar({ people }: { people: People }) {
  const { t } = useTranslation()
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const [query, setQuery] = useState(filters.query ?? '')
  const [open, setOpen] = useState(false)

  // Search as you type, without recomputing at every key press.
  useEffect(() => {
    const timer = setTimeout(() => setFilters({ query }), 250)
    return () => clearTimeout(timer)
  }, [query, setFilters])

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (filters.origin) chips.push({ key: 'o', label: `${t('viewer.origin')}: ${t(`origin.${filters.origin}`)}`, clear: () => setFilters({ origin: null }) })
  if (filters.status) chips.push({ key: 's', label: t(`filters.status.${filters.status}`), clear: () => setFilters({ status: null }) })
  if (filters.compression) chips.push({ key: 'c', label: t(`filters.compression.${filters.compression}`), clear: () => setFilters({ compression: null }) })
  const active = chips.length

  return (
    <div className="filter-bar">
      <div className="row">
        <label className="search">
          <Search size={16} />
          <input
            type="search"
            dir="auto"
            value={query}
            placeholder={t('filters.searchPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('filters.search')}
          />
          {query && (
            <button className="icon-btn small" onClick={() => setQuery('')} aria-label={t('common.close')}>
              <X size={14} />
            </button>
          )}
        </label>
        <button className={`btn ${open || active ? 'primary' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <SlidersHorizontal size={16} />
          <span className="only-desktop">{t('filters.button')}</span>
          {active > 0 && <span className="badge-count">{active}</span>}
        </button>
        {chips.map((c) => (
          <span key={c.key} className="chip">
            {c.label}
            <button className="icon-btn small" onClick={c.clear} aria-label={t('common.close')}>
              <X size={14} />
            </button>
          </span>
        ))}
      </div>
      {open && (
        <div className="filter-panel">
          <label className="field">
            {t('viewer.origin')}
            <select value={filters.origin ?? ''} onChange={(e) => setFilters({ origin: (e.target.value || null) as Origin | null })}>
              <option value="">{t('common.all')}</option>
              {ORIGINS.map((o) => (
                <option key={o} value={o}>{t(`origin.${o}`)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('filters.statusTitle')}
            <select value={filters.status ?? ''} onChange={(e) => setFilters({ status: (e.target.value || null) as Status | null })}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{t(`filters.status.${s}`)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('compress.status')}
            <select value={filters.compression ?? ''} onChange={(e) => setFilters({ compression: (e.target.value || null) as CompressionState | null })}>
              <option value="">{t('common.all')}</option>
              {COMPRESSIONS.map((c) => (
                <option key={c} value={c}>{t(`filters.compression.${c}`)}</option>
              ))}
            </select>
          </label>
          {people.named.length > 0 && (
            <label className="field">
              {t('faces.people')}
              <select
                value={filters.personId ?? ''}
                onChange={(e) => setFilters({ personId: e.target.value || null, ...(e.target.value ? { categoryId: null, albumId: null } : {}) })}
              >
                <option value="">{t('common.all')}</option>
                {people.named.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          {active > 0 && (
            <button className="btn ghost" onClick={() => setFilters({ origin: null, status: null, compression: null })}>
              {t('filters.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
