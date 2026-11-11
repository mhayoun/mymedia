import { FolderOpen } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORY_KEYS, proposeCategories, type CategoryKey } from '../lib/proposeCategories'

export interface ProposalAlbum {
  name: string
  /** Photos and videos it holds (with its sub-folders). */
  count: number
}

interface Choice {
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
export function useCategoryProposal(albums: ProposalAlbum[]) {
  const { t } = useTranslation()
  const names = useMemo(() => albums.map((a) => a.name), [albums])
  const proposed = useMemo(() => proposeCategories(names), [names])
  const [choice, setChoice] = useState<Choice>({ moved: {}, labels: {}, off: [] })
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

/** The proposed categories, each with its albums: rename, untick, or move an album to another one. */
export function CategoryProposal({ state }: { state: CategoryProposalState }) {
  const { t } = useTranslation()
  const { albums, choice, setChoice, keyOf, labelOf } = state
  const groups = CATEGORY_KEYS.map((key) => ({ key, albums: albums.filter((a) => keyOf(a.name) === key) })).filter((g) => g.albums.length)
  const none = albums.filter((a) => keyOf(a.name) === null)

  const move = (name: string, value: string) => setChoice((c) => ({ ...c, moved: { ...c.moved, [name]: value ? (value as CategoryKey) : null } }))
  const albumRow = (a: ProposalAlbum, key: CategoryKey | null) => (
    <li key={a.name} className="proposal-album">
      <span className="name">
        <FolderOpen size={14} /> <bdi>{a.name}</bdi> <span className="hint">{a.count}</span>
      </span>
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

  return (
    <div className="category-proposal">
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
              <span className="hint">{t('autoCategories.albums', { count: list.length })}</span>
            </div>
            <ul>{list.map((a) => albumRow(a, key))}</ul>
          </section>
        )
      })}
      {none.length > 0 && (
        <section>
          <div className="proposal-head">
            <strong>{t('autoCategories.none')}</strong>
            <span className="hint">{t('autoCategories.noneHint')}</span>
          </div>
          <ul>{none.map((a) => albumRow(a, null))}</ul>
        </section>
      )}
    </div>
  )
}
