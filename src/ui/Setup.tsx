import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rootReady } from '../session'
import { useApp } from '../store'
import { createRoot } from '../sync/engine'
import { LanguageSwitch } from './SignIn'

export function Setup() {
  const { t } = useTranslation()
  const rootName = useApp((s) => s.settings.rootName)
  const [name, setName] = useState(rootName)
  const [categories, setCategories] = useState<string[]>(() => t('setup.defaultCategories', { returnObjects: true }) as string[])
  const [newCat, setNewCat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    const v = newCat.trim()
    if (v && !categories.includes(v)) setCategories([...categories, v])
    setNewCat('')
  }

  async function create() {
    if (!name.trim()) return setError(t('folders.invalidName'))
    setBusy(true)
    setError(null)
    try {
      await createRoot(name.trim(), categories)
      await rootReady()
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="card">
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.noRoot', { name: rootName })}</p>
        <label className="field">
          {t('setup.rootName')}
          <input type="text" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div>{t('setup.categories')}</div>
        <div className="chip-list">
          {categories.map((c) => (
            <span className="chip" key={c}>
              <bdi>{c}</bdi>
              <button className="icon-btn small" aria-label={t('common.delete')} onClick={() => setCategories(categories.filter((x) => x !== c))}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); add() }}>
          <input type="text" dir="auto" value={newCat} placeholder={t('setup.addCategory')} onChange={(e) => setNewCat(e.target.value)} style={{ flex: 1, inlineSize: 'auto' }} />
          <button className="btn" type="submit" aria-label={t('setup.addCategory')}>
            <Plus size={16} />
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={create}>
            {busy ? t('setup.creating') : t('setup.create')}
          </button>
        </div>
        <LanguageSwitch />
      </div>
    </div>
  )
}

export function RootMissing() {
  const { t } = useTranslation()
  const rootName = useApp((s) => s.settings.rootName)
  const set = useApp((s) => s.set)
  const [busy, setBusy] = useState(false)
  return (
    <div className="center-screen">
      <div className="card">
        <h1>{t('setup.rootMissingTitle')}</h1>
        <p>{t('setup.rootMissingText', { name: rootName })}</p>
        <div className="actions">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await rootReady()
                if (useApp.getState().phase !== 'app') set({ phase: 'rootMissing' })
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('setup.restored')}
          </button>
          <button className="btn" onClick={() => set({ phase: 'setup' })}>
            {t('setup.createNew')}
          </button>
        </div>
      </div>
    </div>
  )
}
