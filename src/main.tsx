import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initI18n } from './i18n'
import './index.css'
// Early: the browser offers the installation only once, at load.
import './lib/install'
import { startActivityLog } from './activity'
import { loadNativeShared } from './import/shared'
import { app } from './store'
import { App } from './ui/App'
import { ErrorBoundary } from './ui/ErrorBoundary'

startActivityLog()
await initI18n(app().settings.language)
await loadNativeShared()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
