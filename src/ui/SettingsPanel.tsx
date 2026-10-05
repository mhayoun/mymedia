import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { db } from '../db/db'
import { renameFile } from '../drive/api'
import { changeLanguage, LANGUAGES } from '../i18n'
import { signOut } from '../session'
import { useApp, type Language } from '../store'
import { syncNow } from '../sync/engine'
import { PromptDialog } from './Dialog'

export function SettingsPanel() {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const user = useApp((s) => s.user)
  const rootId = useApp((s) => s.rootId)
  const set = useApp((s) => s.set)
  const [renaming, setRenaming] = useState(false)
  const [cleared, setCleared] = useState(false)
  const close = () => set({ settingsOpen: false })

  const setLanguage = (lang: Language) => {
    updateSettings({ language: lang })
    void changeLanguage(lang)
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('settings.title')}>
        <header>
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X />
          </button>
        </header>

        <section>
          <h3>{t('settings.language')}</h3>
          <div className="segmented">
            {LANGUAGES.map((l) => (
              <button key={l} lang={l} aria-pressed={settings.language === l} onClick={() => setLanguage(l)}>
                {t(`languages.${l}`)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>{t('settings.loading')}</h3>
          <label className="radio-row">
            <input type="radio" name="syncMode" checked={settings.syncMode === 'auto'} onChange={() => updateSettings({ syncMode: 'auto' })} />
            {t('settings.syncAuto')}
          </label>
          <label className="radio-row">
            <input type="radio" name="syncMode" checked={settings.syncMode === 'manual'} onChange={() => updateSettings({ syncMode: 'manual' })} />
            {t('settings.syncManual')}
          </label>
          {settings.syncMode === 'auto' && (
            <>
              <label className="field" style={{ maxWidth: 220, marginBlockStart: 8 }}>
                {t('settings.syncInterval')}
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={settings.syncIntervalMin}
                  onChange={(e) => updateSettings({ syncIntervalMin: Math.min(240, Math.max(1, Number(e.target.value) || 15)) })}
                />
              </label>
              <p className="hint">{t('settings.syncAutoHint')}</p>
            </>
          )}
          <button className="btn" onClick={() => { close(); void syncNow({ full: true }) }}>
            {t('settings.rescan')}
          </button>
          <p className="hint">{t('settings.rescanHint')}</p>
        </section>

        <section>
          <h3>{t('settings.rootFolder')}</h3>
          <div className="row">
            <bdi>{settings.rootName}</bdi>
            <button className="btn" onClick={() => setRenaming(true)} disabled={!rootId}>
              {t('common.rename')}
            </button>
          </div>
          <p className="hint">{t('settings.rootFolderHint')}</p>
        </section>

        <section>
          <h3>{t('settings.account')}</h3>
          {user && <p>{t('settings.signedInAs', { email: user.email })}</p>}
          <div className="row">
            <button className="btn" onClick={() => auth.signIn(true)}>
              {t('auth.switchAccount')}
            </button>
            <button className="btn" onClick={signOut}>
              {t('auth.signOut')}
            </button>
          </div>
        </section>

        <section>
          <h3>{t('settings.storage')}</h3>
          <button
            className="btn"
            disabled={cleared}
            onClick={async () => {
              await db().thumbs.clear()
              setCleared(true)
            }}
          >
            {t('settings.clearThumbs')}
          </button>
          <p className="hint">{t('settings.version', { version: __APP_VERSION__ })}</p>
        </section>
      </aside>

      {renaming && rootId && (
        <PromptDialog
          title={t('folders.renameTitle', { name: settings.rootName })}
          initial={settings.rootName}
          onSubmit={async (name) => {
            await renameFile(rootId, name)
            updateSettings({ rootName: name })
          }}
          onClose={() => setRenaming(false)}
        />
      )}
    </>
  )
}
