import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { assignFaces, rejectSuggestion } from '../faces/engine'
import { useApp } from '../store'
import { FaceImg } from './FaceImg'
import { useOpenPerson } from './peopleContext'
import type { People, PersonInfo } from './usePeople'

function PersonCard({ p }: { p: PersonInfo }) {
  const { t } = useTranslation()
  const open = useOpenPerson()
  return (
    <button className="person-card" onClick={() => open(p.id)}>
      <FaceImg face={p.cover} size={96} />
      <span className="person-name">{p.name ? <bdi>{p.name}</bdi> : <span className="hint">{t('faces.nameIt')}</span>}</span>
      <span className="hint">{t('gallery.count', { count: p.mediaIds.size })}</span>
    </button>
  )
}

/** All the people: to confirm, named, to name, single faces. */
export function PeopleView({ people }: { people: People }) {
  const { t } = useTranslation()
  const enabled = useApp((s) => s.settings.facesEnabled)
  const indexing = useApp((s) => s.indexing)
  const [showSingles, setShowSingles] = useState(false)

  if (!enabled) return <div className="empty">{t('faces.disabled')}</div>
  const nothing = !people.named.length && !people.unnamed.length && !people.single.length
  return (
    <div className="gallery-scroll people-view">
      {nothing && (
        <div className="empty">
          <p>{t('faces.none')}</p>
          <p className="hint">{indexing ? t('faces.searching') : t('faces.noneHint')}</p>
        </div>
      )}

      {people.toConfirm.length > 0 && (
        <section>
          <h2>{t('faces.toConfirm', { count: people.toConfirm.length })}</h2>
          <div className="confirm-grid">
            {people.toConfirm.slice(0, 60).map((f) => {
              const p = people.byId.get(f.suggested!)
              if (!p) return null
              return (
                <div key={f.id} className="confirm-card">
                  <FaceImg face={f} size={72} />
                  <span>
                    {t('faces.isIt')} <bdi>{p.name}</bdi> ?
                  </span>
                  <span className="row">
                    <button className="btn primary" onClick={() => assignFaces([f.id], p.id)} aria-label={t('faces.yes')}>
                      <Check size={16} /> {t('faces.yes')}
                    </button>
                    <button className="btn" onClick={() => rejectSuggestion(f.id)} aria-label={t('faces.no')}>
                      <X size={16} /> {t('faces.no')}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {people.named.length > 0 && (
        <section>
          <h2>{t('faces.named')}</h2>
          <div className="people-grid">
            {people.named.map((p) => (
              <PersonCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      {people.unnamed.length > 0 && (
        <section>
          <h2>{t('faces.toName')}</h2>
          <p className="hint">{t('faces.toNameHint')}</p>
          <div className="people-grid">
            {people.unnamed.map((p) => (
              <PersonCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      {people.single.length > 0 && (
        <section>
          <button className="btn ghost" onClick={() => setShowSingles((v) => !v)}>
            {t('faces.singles', { count: people.single.length })}
          </button>
          {showSingles && (
            <div className="people-grid">
              {people.single.slice(0, 300).map((p) => (
                <PersonCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
