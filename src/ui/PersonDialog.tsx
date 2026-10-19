import { CheckSquare, CircleHelp, Images, Loader2, Merge, Scissors, UserMinus, UserRound, UserX } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { assignFaces, mergePersons, namePerson, removeFaces, setCover, splitFaces } from '../faces/engine'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'
import { FaceImg } from './FaceImg'
import type { People } from './usePeople'

const PAGE = 120

/** One person: name, see photos, merge with another group, fix wrong faces. */
export function PersonDialog({ people, personId, onClose }: { people: People; personId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const set = useApp((s) => s.set)
  const setFilters = useApp((s) => s.setFilters)
  const person = people.byId.get(personId)
  const [name, setName] = useState(person?.name ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [forgetOpen, setForgetOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  if (!person) return null

  const allSelected = person.faces.length > 0 && person.faces.every((f) => selected.has(f.id))
  const others = [...people.named, ...people.unnamed].filter((p) => p.id !== person.id)
  const label = (p: { name?: string; faces: unknown[] }) => p.name ?? t('faces.unnamedCount', { count: p.faces.length })
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      setSelected(new Set())
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Modal wide title={person.name ?? t('faces.unnamed')} onClose={onClose}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void run(() => namePerson(person.id, name)).then(onClose, (err) => console.error('[MyMedia] name not saved', err))
        }}
      >
        <FaceImg face={person.cover} size={72} />
        <input type="text" dir="auto" list="people-names" value={name} placeholder={t('faces.namePlaceholder')} onChange={(e) => setName(e.target.value)} style={{ inlineSize: 'auto', flex: '0 1 16rem', minInlineSize: 0 }} />
        <datalist id="people-names">
          {people.named.filter((p) => p.id !== person.id).map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <button className="btn primary" type="submit" disabled={busy || !name.trim() || name.trim() === person.name}>
          {busy && <Loader2 size={14} className="spin" />} {t('common.save')}
        </button>
      </form>

      <div className="row" style={{ marginBlock: 10 }}>
        <button
          className="btn"
          onClick={() => {
            setFilters({ personId: person.id, categoryId: null, albumId: null, provenance: null })
            set({ sidebarOpen: false })
            onClose()
          }}
        >
          <Images size={16} /> {t('faces.seePhotos', { count: person.mediaIds.size })}
        </button>
        <button className="btn" disabled={busy} onClick={() => setForgetOpen(true)} title={t('faces.forgetHint')}>
          <UserX size={16} /> {t('faces.forget')}
        </button>
        {others.length > 0 && (
          <label className="row">
            <Merge size={16} />
            <select value="" disabled={busy} onChange={(e) => e.target.value && run(() => mergePersons(person.id, [e.target.value]))} style={{ inlineSize: 'auto' }}>
              <option value="">{t('faces.mergeWith')}</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => setSelected(allSelected ? new Set() : new Set(person.faces.map((f) => f.id)))}
        >
          <CheckSquare size={16} /> {allSelected ? t('select.none') : t('select.all')}
        </button>
        <button className="btn ghost" aria-expanded={helpOpen} onClick={() => setHelpOpen((o) => !o)} title={t('nav.help')} aria-label={t('nav.help')}>
          <CircleHelp size={16} />
        </button>
      </div>
      {helpOpen && (
        <div className="hint" style={{ marginBlockEnd: 10 }}>
          <p>{t('faces.nameHint')}</p>
          <p>{t('faces.facesHint', { count: person.faces.length, n: fmt.number(person.faces.length) })}</p>
          <p>{t('faces.coverHint')}</p>
        </div>
      )}

      {forgetOpen && (
        <ConfirmDialog
          title={t('faces.forgetTitle', { name: person.name ?? t('faces.unnamed') })}
          text={t('faces.forgetText', { count: person.mediaIds.size })}
          confirmLabel={t('faces.forget')}
          danger
          onConfirm={() => run(() => removeFaces(person.faces.map((f) => f.id))).then(onClose)}
          onClose={() => setForgetOpen(false)}
        />
      )}
      <div className="face-grid">
        {person.faces.slice(0, shown).map((f) => (
          <label key={f.id} className={`face-pick ${selected.has(f.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
            <FaceImg face={f} size={72} />
          </label>
        ))}
      </div>
      {person.faces.length > shown && (
        <button className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>
          {t('classify.showMore', { count: person.faces.length - shown })}
        </button>
      )}

      {selected.size > 0 && (
        <div className="row selection-bar">
          <strong>{t('faces.selected', { count: selected.size })}</strong>
          <button className="btn" disabled={busy} onClick={() => run(() => removeFaces([...selected]))}>
            <UserMinus size={16} /> {person.name ? t('faces.notThisPerson', { name: person.name }) : t('faces.notThisGroup')}
          </button>
          {selected.size === 1 && (
            <button className="btn" disabled={busy || person.cover.id === [...selected][0]} onClick={() => run(() => setCover(person.id, [...selected][0]))}>
              <UserRound size={16} /> {t('faces.useAsCover')}
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => run(() => splitFaces([...selected]))}>
            <Scissors size={16} /> {t('faces.newPerson')}
          </button>
          {others.length > 0 && (
            <select value="" disabled={busy} onChange={(e) => e.target.value && run(() => assignFaces([...selected], e.target.value))} style={{ inlineSize: 'auto' }}>
              <option value="">{t('faces.moveTo')}</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p)}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </Modal>
  )
}
