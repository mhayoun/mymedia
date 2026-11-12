import { FolderOpen } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORY_KEYS, proposeCategories, type CategoryKey } from '../lib/proposeCategories'

export interface ProposalAlbum {
  name: string
  /** Photos and videos it holds (with its sub-folders). */
  count: number
}

export interface CategoryChoice {
  /** Albums moved by hand to another category (null: no category). */
  moved: Record<string, CategoryKey | null>
  /** Category names changed by hand. */
  labels: Partial<Record<CategoryKey, string>>
  /** Categories unticked: their albums stay without a category. */
  off: CategoryKey[]
}

/**
 * Categories proposed from the folder names: the proposal, the changes made by hand, and the category
 * each album goes to (its name in the app's language, or as renamed; null when none).
 */
export function useCategoryProposal(albums: ProposalAlbum[], initial?: CategoryChoice) {
  const { t } = useTranslation()
  const names = useMemo(() => albums.map((a) => a.name), [albums])
  const proposed = useMemo(() => proposeCategories(names), [names])
  const [choice, setChoice] = useState<CategoryChoice>(() => initial ?? { moved: {}, labels: {}, off: [] })
  const keyOf = useCallback(
    (name: string): CategoryKey | null => (name in choice.moved ? choice.moved[name] : (proposed.get(name) ?? null)),
    [choice.moved, proposed],
  )
  const labelOf = useCallback((key: CategoryKey) => choice.labels[key] ?? t(`autoCategories.${key}`), [choice.labels, t])
  const categoryOf = useCallback(
    (name: string): string | null => {
      const key = keyOf(name)
      if (!key || choice.off.includes(key)) return null
      return labelOf(key).trim() || t(`autoCategories.${key}`)
    },
    [keyOf, labelOf, choice.off, t],
  )
  return { albums, choice, setChoice, keyOf, labelOf, categoryOf }
}

export type CategoryProposalState = ReturnType<typeof useCategoryProposal>

/** Albums ticked to be imported together. */
export interface AlbumChecks {
  isOn: (name: string) => boolean
  set: (names: string[], on: boolean) => void
}

/** The proposed categories, each with its albums: rename, untick, or move an album to another one. */
export function CategoryProposal({
  state,
  show,
  extra,
  checks,
}: {
  state: CategoryProposalState
  /** Only these albums (e.g. those not imported yet); all by default. */
  show?: (name: string) => boolean
  /** More on an album's line (size, Import button…). */
  extra?: (a: ProposalAlbum) => ReactNode
  /** A box on each album (and "tick all" in each category), to import several at once. */
  checks?: AlbumChecks
}) {
  const { t } = useTranslation()
  const { choice, setChoice, keyOf, labelOf } = state
  const albums = show ? state.albums.filter((a) => show(a.name)) : state.albums
  const groups = CATEGORY_KEYS.map((key) => ({ key, albums: albums.filter((a) => keyOf(a.name) === key) })).filter((g) => g.albums.length)
  const none = albums.filter((a) => keyOf(a.name) === null)

  const move = (name: string, value: string) => setChoice((c) => ({ ...c, moved: { ...c.moved, [name]: value ? (value as CategoryKey) : null } }))
  const albumRow = (a: ProposalAlbum, key: CategoryKey | null) => (
    <li key={a.name} className="proposal-album">
      <span className="name">
        {checks && (
          <input
            type="checkbox"
            checked={checks.isOn(a.name)}
            onChange={(e) => checks.set([a.name], e.target.checked)}
            aria-label={t('autoCategories.tick', { name: a.name })}
          />
        )}
        <FolderOpen size={14} /> <bdi>{a.name}</bdi> {a.count > 0 && <span className="hint">{a.count}</span>}
      </span>
      {extra?.(a)}
      <select value={key ?? ''} onChange={(e) => move(a.name, e.target.value)} aria-label={t('autoCategories.moveTo', { name: a.name })}>
        {CATEGORY_KEYS.map((k) => (
          <option key={k} value={k}>
            {labelOf(k)}
          </option>
        ))}
        <option value="">{t('autoCategories.none')}</option>
      </select>
    </li>
  )

  const examples = (list: ProposalAlbum[]) =>
    [...list]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((a) => a.name)
      .join(', ') + (list.length > 3 ? '…' : '')
  const kept = groups.filter((g) => !choice.off.includes(g.key)).length
  /** "Tick all" at the top of a category's albums. */
  const tickAll = (list: ProposalAlbum[]) => {
    if (!checks || list.length < 2) return null
    const all = list.every((a) => checks.isOn(a.name))
    return (
      <li className="proposal-album tick-all">
        <label className="name">
          <input type="checkbox" checked={all} onChange={() => checks.set(list.map((a) => a.name), !all)} /> {t('autoCategories.tickAll', { count: list.length })}
        </label>
      </li>
    )
  }

  return (
    <div className="category-proposal">
      <p>
        <strong>{t('autoCategories.listTitle', { count: kept })}</strong>
      </p>
      <p className="hint">{t('autoCategories.hint')}</p>
      {groups.map(({ key, albums: list }) => {
        const on = !choice.off.includes(key)
        return (
          <section key={key} className={on ? '' : 'off'}>
            <div className="proposal-head">
              <input
                type="checkbox"
                checked={on}
                aria-label={t('autoCategories.create', { name: labelOf(key) })}
                onChange={() => setChoice((c) => ({ ...c, off: on ? [...c.off, key] : c.off.filter((k) => k !== key) }))}
              />
              <input
                type="text"
                value={labelOf(key)}
                disabled={!on}
                onChange={(e) => setChoice((c) => ({ ...c, labels: { ...c.labels, [key]: e.target.value } }))}
                aria-label={t('autoCategories.rename')}
              />
            </div>
            <details>
              <summary className="hint">
                {t('autoCategories.albums', { count: list.length })} · <bdi>{examples(list)}</bdi>
              </summary>
              <ul>
                {tickAll(list)}
                {list.map((a) => albumRow(a, key))}
              </ul>
            </details>
          </section>
        )
      })}
      {none.length > 0 && (
        <section>
          <div className="proposal-head">
            <strong>{t('autoCategories.none')}</strong>
          </div>
          <details>
            <summary className="hint">
              {t('autoCategories.albums', { count: none.length })} — {t('autoCategories.noneHint')}
            </summary>
            <ul>
              {tickAll(none)}
              {none.map((a) => albumRow(a, null))}
            </ul>
          </details>
        </section>
      )}
    </div>
  )
}
