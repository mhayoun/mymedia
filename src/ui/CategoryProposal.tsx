import { FolderOpen, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CATEGORY_KEYS, proposeCategories, type CategoryKey } from '../lib/proposeCategories'
import { useLibraryContext } from './libraryContext'

const LANGUAGES = ['fr', 'en', 'he'] as const
/** Former names of a category, still recognised in MyMedia. */
const FORMER: Partial<Record<CategoryKey, string[]>> = { school: ['בית ספר וגן'] }
const loose = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export interface ProposalAlbum {
  name: string
  /** Photos and videos it holds (with its sub-folders). */
  count: number
}

/** A proposed category, or one made in MyMedia by the user ("own:בית"), by its name. */
export type ChoiceKey = CategoryKey | `own:${string}`
const OWN = 'own:'
const isOwn = (key: ChoiceKey): key is `own:${string}` => key.startsWith(OWN)

export interface CategoryChoice {
  /** Albums moved by hand to another category (null: no category). */
  moved: Record<string, ChoiceKey | null>
  /** Category names changed by hand. */
  labels: Partial<Record<CategoryKey, string>>
  /** Categories unticked: their albums stay without a category. */
  off: ChoiceKey[]
}

/**
 * Categories proposed from the folder names: the proposal, the changes made by hand, and the category
 * each album goes to (its name in the app's language, or as renamed; null when none).
 */
export function useCategoryProposal(albums: ProposalAlbum[], initial?: CategoryChoice) {
  const { t, i18n } = useTranslation()
  const lib = useLibraryContext()
  // A category already in MyMedia under its name in another language ("טיולים ויציאות" while the app is
  // in French): that one is used, not a second one made.
  const existing = useMemo(() => {
    const out: Partial<Record<CategoryKey, string>> = {}
    const categories = lib?.categories ?? []
    for (const key of CATEGORY_KEYS) {
      const names = new Set([...LANGUAGES.map((lng) => i18n.getFixedT(lng)(`autoCategories.${key}`)), ...(FORMER[key] ?? [])].map(loose))
      const found = categories.find((c) => names.has(loose(c.name)))
      if (found) out[key] = found.name
    }
    return out
  }, [lib?.categories, i18n])
  // The categories made in MyMedia by the user ("בית"), offered too: a folder with albums in it, or still empty
  // (a folder with photos only is an album without a category).
  const own = useMemo(() => {
    const known = new Set(Object.values(existing).map(loose))
    return (lib?.categories ?? [])
      .filter((c) => (c.children.length > 0 || c.count === 0) && !known.has(loose(c.name)))
      .map((c) => `${OWN}${c.name}` as const)
      .sort((a, b) => a.localeCompare(b))
  }, [lib?.categories, existing])
  /** Every category an album can go to: the proposed ones, then the user's. */
  const keys = useMemo<ChoiceKey[]>(() => [...CATEGORY_KEYS, ...own], [own])
  const names = useMemo(() => albums.map((a) => a.name), [albums])
  // A category's name typed as one of the albums ("2011_gp" in "Divers", meant to put the album in it): not
  // a name for the category, which keeps its own (the album is put in it with its list).
  const albumNames = useMemo(() => new Set(names.map(loose)), [names])
  const proposed = useMemo(() => proposeCategories(names), [names])
  const [choice, setChoice] = useState<CategoryChoice>(() => initial ?? { moved: {}, labels: {}, off: [] })
  const keyOf = useCallback(
    (name: string): ChoiceKey | null => (name in choice.moved ? choice.moved[name] : (proposed.get(name) ?? null)),
    [choice.moved, proposed],
  )
  /** The name a proposed category has without a change by hand (MyMedia's, else in the app's language). */
  const defaultLabel = useCallback((key: CategoryKey) => existing[key] ?? t(`autoCategories.${key}`), [existing, t])
  const labelOf = useCallback(
    (key: ChoiceKey) => {
      if (isOwn(key)) return key.slice(OWN.length)
      const v = choice.labels[key]
      return v !== undefined && !albumNames.has(loose(v)) ? v : defaultLabel(key)
    },
    [choice.labels, albumNames, defaultLabel],
  )
  const categoryOf = useCallback(
    (name: string): string | null => {
      const key = keyOf(name)
      if (!key || choice.off.includes(key)) return null
      if (isOwn(key)) return labelOf(key)
      return labelOf(key).trim() || existing[key] || t(`autoCategories.${key}`)
    },
    [keyOf, labelOf, choice.off, existing, t],
  )
  return { albums, choice, setChoice, keyOf, labelOf, defaultLabel, categoryOf, keys }
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
  const { choice, setChoice, keyOf, labelOf, defaultLabel, keys } = state
  const albums = show ? state.albums.filter((a) => show(a.name)) : state.albums
  const groups = keys.map((key) => ({ key, albums: albums.filter((a) => keyOf(a.name) === key) })).filter((g) => g.albums.length)
  const none = albums.filter((a) => keyOf(a.name) === null)

  const move = (name: string, value: string) => setChoice((c) => ({ ...c, moved: { ...c.moved, [name]: value ? (value as ChoiceKey) : null } }))
  const albumRow = (a: ProposalAlbum, key: ChoiceKey | null) => (
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
        {keys.map((k) => (
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
                // A category of MyMedia keeps its name here (it is renamed in MyMedia itself).
                disabled={!on || isOwn(key)}
                onChange={(e) => !isOwn(key) && setChoice((c) => ({ ...c, labels: { ...c.labels, [key]: e.target.value } }))}
                aria-label={t('autoCategories.rename')}
              />
              {!isOwn(key) && labelOf(key) !== defaultLabel(key) && (
                <button
                  type="button"
                  className="btn icon small"
                  title={t('autoCategories.resetName', { name: defaultLabel(key) })}
                  aria-label={t('autoCategories.resetName', { name: defaultLabel(key) })}
                  onClick={() =>
                    setChoice((c) => {
                      const labels = { ...c.labels }
                      delete labels[key]
                      return { ...c, labels }
                    })
                  }
                >
                  <RotateCcw size={14} />
                </button>
              )}
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
