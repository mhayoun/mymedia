import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initI18n } from './i18n'
import './index.css'
// Early: the browser offers the installation only once, at load.
import './lib/install'
import { startActivityLog } from './activity'
import { app } from './store'
import { App } from './ui/App'

startActivityLog()
await initI18n(app().settings.language)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
