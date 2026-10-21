import { Check, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FaceRecord } from '../db/db'
import { assignFaces, namePerson, recheckNames, rejectSuggestion, splitFaces } from '../faces/engine'
import { app, useApp } from '../store'
import { ConfirmDialog } from './Dialog'
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

const NEW_PERSON = '__new'

/** "Is this X?": yes, no, or another person (existing or new). */
function ConfirmCard({ face, person, people }: { face: FaceRecord; person: PersonInfo; people: People }) {
  const { t } = useTranslation()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const others = people.named.filter((p) => p.id !== person.id)
  const giveName = async () => {
    if (!name.trim()) return
    await namePerson(await splitFaces([face.id]), name)
  }
  return (
    <div className="confirm-card">
      <FaceImg face={face} size={72} />
      <span>
        {t('faces.isIt')} <bdi>{person.name}</bdi> ?
      </span>
      <span className="row">
        <button className="btn primary" onClick={() => assignFaces([face.id], person.id)} aria-label={t('faces.yes')}>
          <Check size={16} /> {t('faces.yes')}
        </button>
        <button className="btn" onClick={() => rejectSuggestion(face.id)} aria-label={t('faces.no')}>
          <X size={16} /> {t('faces.no')}
        </button>
      </span>
      {naming ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void giveName()
          }}
        >
          <input
            type="text"
            dir="auto"
            autoFocus
            list="confirm-names"
            value={name}
            placeholder={t('faces.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            style={{ inlineSize: '9rem' }}
          />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            {t('common.ok')}
          </button>
        </form>
      ) : (
        <select
          value=""
          aria-label={t('faces.otherPerson')}
          onChange={(e) => {
            const v = e.target.value
            if (v === NEW_PERSON) setNaming(true)
            else if (v) void assignFaces([face.id], v)
          }}
          style={{ inlineSize: 'auto', maxInlineSize: '100%' }}
        >
          <option value="">{t('faces.otherPerson')}</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={NEW_PERSON}>{t('faces.itIsNew')}</option>
        </select>
      )}
    </div>
  )
}

/** All the people: to confirm, named, to name, single faces. */
export function PeopleView({ people }: { people: People }) {
  const { t } = useTranslation()
  const enabled = useApp((s) => s.settings.facesEnabled)
  const indexing = useApp((s) => s.indexing)
  const [showSingles, setShowSingles] = useState(false)
  const [recheck, setRecheck] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const startRecheck = async () => {
    setChecking(true)
    try {
      const n = await recheckNames(false)
      if (n) setRecheck(n)
      else app().set({ toast: { key: 'faces.recheckNone' } })
    } finally {
      setChecking(false)
    }
  }

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

      {people.named.length > 0 && (
        <div className="row" style={{ marginBlockEnd: 8 }}>
          <button className="btn" disabled={checking} onClick={() => void startRecheck()} title={t('faces.recheckHint')}>
            <ShieldCheck size={16} /> {t('faces.recheck')}
          </button>
        </div>
      )}
      {recheck !== null && (
        <ConfirmDialog
          title={t('faces.recheck')}
          text={t('faces.recheckText', { count: recheck })}
          confirmLabel={t('faces.recheck')}
          onConfirm={async () => {
            const n = await recheckNames(true)
            app().set({ toast: { key: 'faces.recheckDone', count: n } })
          }}
          onClose={() => setRecheck(null)}
        />
      )}

      {people.toConfirm.length > 0 && (
        <section>
          <h2>{t('faces.toConfirm', { count: people.toConfirm.length })}</h2>
          <datalist id="confirm-names">
            {people.named.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
          <div className="confirm-grid">
            {people.toConfirm.slice(0, 60).map((f) => {
              const p = people.byId.get(f.suggested!)
              if (!p) return null
              return <ConfirmCard key={f.id} face={f} person={p} people={people} />
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
