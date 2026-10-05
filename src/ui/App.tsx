import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boot } from '../session'
import { useApp } from '../store'
import { RootMissing, Setup } from './Setup'
import { Shell } from './Shell'
import { NotConfigured, SignIn } from './SignIn'

export function App() {
  const { t } = useTranslation()
  const phase = useApp((s) => s.phase)
  const [configured, setConfigured] = useState(true)

  useEffect(() => {
    boot().then((r) => setConfigured(r === 'ok'))
  }, [])

  if (!configured) return <NotConfigured />
  switch (phase) {
    case 'boot':
      return <div className="center-screen">{t('common.loading')}</div>
    case 'signedOut':
      return <SignIn />
    case 'setup':
      return <Setup />
    case 'rootMissing':
      return <RootMissing />
    case 'app':
      return <Shell />
  }
}
