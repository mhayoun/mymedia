import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { changeLanguage, LANGUAGES } from '../i18n'
import { signOut } from '../session'
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
  const { t, i18n } = useTranslation()
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
        <p className="hint">
          <a href={`/about.html?lang=${i18n.language.slice(0, 2)}`}>{t('auth.aboutLink')}</a> ·{' '}
          <a href={`/privacy.html?lang=${i18n.language.slice(0, 2)}`}>{t('auth.privacyLink')}</a>
        </p>
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

/**
 * This account used MyMedia's full door (whole Drive): it came in by the free one on this device,
 * Google must now give the full access (a click is needed to open Google's window).
 */
export function FullAccess() {
  const { t } = useTranslation()
  const user = useApp((s) => s.user)
  const error = useAuthError()
  return (
    <div className="center-screen">
      <div className="card">
        <img className="logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <h1>{t('app.name')}</h1>
        <p>
          <bdi dir="ltr">{user?.email}</bdi>
        </p>
        <p>{t('door.fullText')}</p>
        <p className="hint">{t('door.warning')}</p>
        <div className="actions">
          <button className="btn primary" onClick={() => user && auth.upgrade(user.email)}>
            {t('door.continue')}
          </button>
        </div>
        {error === 'scope_denied' && <p className="error-text">{t('door.denied')}</p>}
        {error === 'popup_failed_to_open' && <p className="error-text">{t('auth.popupBlocked')}</p>}
        <p className="hint">
          <button className="btn" onClick={() => signOut()}>
            {t('auth.switchAccount')}
          </button>
        </p>
      </div>
    </div>
  )
}
