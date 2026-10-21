import { Check, CheckSquare, ShieldCheck, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FaceRecord } from '../db/db'
import { assignFaces, namePerson, recheckNames, rejectSuggestions, splitFaces } from '../faces/engine'
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
const GROUP_PAGE = 30

/**
 * "Is this X?" for all the faces suggested for X at once: all ticked, the
 * user unticks the wrong ones, then Yes, No, or another person (existing or new).
 */
function ConfirmGroup({ person, faces, people }: { person: PersonInfo; faces: FaceRecord[]; people: People }) {
  const { t } = useTranslation()
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(GROUP_PAGE)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const sel = faces.filter((f) => !unticked.has(f.id)).map((f) => f.id)
  const others = people.named.filter((p) => p.id !== person.id)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setUnticked(new Set())
      setNaming(false)
      setName('')
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) =>
    setUnticked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <section className="confirm-group" aria-busy={busy}>
      <div className="row">
        <FaceImg face={person.cover} size={48} />
        <strong>
          {t('faces.isIt')} <bdi>{person.name}</bdi> ? <span className="count">({faces.length})</span>
        </strong>
        <button className="btn ghost" disabled={busy} onClick={() => setUnticked(sel.length ? new Set(faces.map((f) => f.id)) : new Set())}>
          <CheckSquare size={16} /> {sel.length ? t('select.none') : t('select.all')}
        </button>
      </div>
      <div className="face-grid">
        {faces.slice(0, shown).map((f) => (
          <label key={f.id} className={`face-pick ${unticked.has(f.id) ? '' : 'on'}`}>
            <input type="checkbox" checked={!unticked.has(f.id)} onChange={() => toggle(f.id)} />
            <FaceImg face={f} size={72} />
          </label>
        ))}
      </div>
      {faces.length > shown && (
        <button className="btn ghost" onClick={() => setShown((n) => n + GROUP_PAGE * 2)}>
          {t('classify.showMore', { count: faces.length - shown })}
        </button>
      )}
      <div className="row" style={{ marginBlockStart: 8 }}>
        <button className="btn primary" disabled={busy || !sel.length} onClick={() => run(() => assignFaces(sel, person.id))}>
          <Check size={16} /> {t('faces.yesFor', { count: sel.length, name: person.name })}
        </button>
        <button className="btn" disabled={busy || !sel.length} onClick={() => run(() => rejectSuggestions(sel))}>
          <X size={16} /> {t('faces.noFor', { count: sel.length })}
        </button>
        {naming ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) void run(async () => namePerson(await splitFaces(sel), name))
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
              style={{ inlineSize: '10rem' }}
            />
            <button className="btn primary" type="submit" disabled={busy || !name.trim() || !sel.length}>
              {t('common.ok')}
            </button>
          </form>
        ) : (
          <select
            value=""
            disabled={busy || !sel.length}
            aria-label={t('faces.otherPerson')}
            onChange={(e) => {
              const v = e.target.value
              if (v === NEW_PERSON) setNaming(true)
              else if (v) void run(() => assignFaces(sel, v))
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
    </section>
  )
}

function bySuggested(faces: FaceRecord[]): Map<string, FaceRecord[]> {
  const m = new Map<string, FaceRecord[]>()
  for (const f of faces) m.set(f.suggested!, [...(m.get(f.suggested!) ?? []), f])
  return m
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
          <p className="hint">{t('faces.toConfirmHint')}</p>
          {[...bySuggested(people.toConfirm)]
            .map(([id, faces]) => ({ person: people.byId.get(id), faces }))
            .filter((g): g is { person: PersonInfo; faces: FaceRecord[] } => !!g.person)
            .sort((a, b) => b.faces.length - a.faces.length)
            .map((g) => (
              <ConfirmGroup key={g.person.id} person={g.person} faces={g.faces} people={people} />
            ))}
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
