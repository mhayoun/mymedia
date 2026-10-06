import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HELP } from '../help/content'
import { useApp } from '../store'

/** Splits "Lead sentence. The rest" so the lead can be shown in bold. */
function lead(text: string): [string, string] {
  const m = /^(.+?[.?:؟])\s+(.*)$/s.exec(text)
  return m && m[1].length < 90 ? [m[1], m[2]] : ['', text]
}

/** In-app help, in the interface language. */
export function HelpPanel() {
  const { t } = useTranslation()
  const language = useApp((s) => s.settings.language)
  const set = useApp((s) => s.set)
  const help = HELP[language] ?? HELP.en
  const close = () => set({ helpOpen: false })
  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer help" role="dialog" aria-modal="true" aria-label={help.title}>
        <header>
          <h2>{help.title}</h2>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X />
          </button>
        </header>
        <p className="help-tagline">{help.tagline}</p>
        {help.sections.map((s) => (
          <section key={s.title}>
            <h3>{s.title}</h3>
            {s.intro && <p>{s.intro}</p>}
            <ul>
              {s.items?.map((item) => {
                const [bold, rest] = lead(item)
                return (
                  <li key={item}>
                    {bold && <strong>{bold} </strong>}
                    {rest}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </aside>
    </>
  )
}
