import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { changeLanguage, LANGUAGES } from '../i18n'
import { useApp } from '../store'
import { useAuthError } from './hooks'

export function LanguageSwitch() {
  const { t } = useTranslation()
  const language = useApp((s) => s.settings.language)
  const updateSettings = useApp((s) => s.updateSettings)
  return (
    <div className="lang-switch">
      {LANGUAGES.map((l) => (
        <button
          key={l}
          lang={l}
          aria-pressed={language === l}
          onClick={() => {
            updateSettings({ language: l })
            void changeLanguage(l)
          }}
        >
          {t(`languages.${l}`)}
        </button>
      ))}
    </div>
  )
}

export function SignIn() {
  const { t } = useTranslation()
  const error = useAuthError()
  return (
    <div className="center-screen">
      <div className="card">
        <img className="logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <h1>{t('app.name')}</h1>
        <p className="hint">{t('app.tagline')}</p>
        <div className="actions">
          <button className="btn primary" onClick={() => auth.signIn(!auth.loginHint)}>
            {t('auth.signIn')}
          </button>
        </div>
        {error === 'scope_denied' && <p className="error-text">{t('auth.scopeDenied')}</p>}
        {error === 'popup_failed_to_open' && <p className="error-text">{t('auth.popupBlocked')}</p>}
        <p className="hint">{t('auth.signInHint')}</p>
        <LanguageSwitch />
      </div>
    </div>
  )
}

export function NotConfigured() {
  const { t } = useTranslation()
  return (
    <div className="center-screen">
      <div className="card">
        <h1>{t('app.name')}</h1>
        <p className="error-text">{t('auth.configMissing')}</p>
        <LanguageSwitch />
      </div>
    </div>
  )
}
