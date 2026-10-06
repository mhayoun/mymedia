import { Check, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { compressNow, decline, planMany, postpone, type Planned } from '../compress/engine'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import type { SkipReason } from '../lib/compressPlan'
import { useApp } from '../store'
import { cachedThumbUrl, loadThumb } from '../sync/thumbs'
import { Modal } from './Dialog'

type Props =
  | { mode: 'manual'; title: string; items: MediaRecord[]; onClose: () => void }
  | { mode: 'offer'; title: string; planned: Planned[]; onClose: () => void }

const REASONS: SkipReason[] = ['alreadyCompressed', 'compressedByApp', 'tooSmall', 'noGain', 'videoNotHere', 'format']

function SmallThumb({ rec }: { rec: MediaRecord }) {
  const [url, setUrl] = useState(() => cachedThumbUrl(rec.id))
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    if (!url) loadThumb(rec, () => alive.current).then((u) => alive.current && u && setUrl(u))
    return () => {
      alive.current = false
    }
  }, [rec, url])
  return <span className="list-thumb">{url && <img src={url} alt="" />}</span>
}

/**
 * List of files to compress, each with its size now → estimated size after,
 * and a tick box. After compression, the real new size of each file.
 */
export function CompressDialog(props: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const compressing = useApp((s) => s.compressing)
  const outcomes = useApp((s) => s.compressOutcome)
  const set = useApp((s) => s.set)
  const [planned, setPlanned] = useState<Planned[] | null>(props.mode === 'offer' ? props.planned : null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<'choose' | 'running' | 'done'>('choose')
  const [result, setResult] = useState<{ count: number; saved: number } | null>(null)
  // The list is fixed when the window opens (the library changes while compressing).
  const [initialItems] = useState(props.mode === 'manual' ? props.items : [])

  useEffect(() => {
    if (props.mode !== 'manual') return
    let alive = true
    planMany(initialItems, 'manual').then((p) => alive && setPlanned(p))
    return () => {
      alive = false
    }
  }, [props.mode, initialItems])

  const ok = useMemo(() => (planned ?? []).filter((p) => p.plan.ok), [planned])
  useEffect(() => setChecked(new Set(ok.map((p) => p.rec.id))), [ok])

  const skipped = useMemo(() => {
    const m = new Map<SkipReason, number>()
    for (const p of planned ?? []) if (!p.plan.ok) m.set(p.plan.reason, (m.get(p.plan.reason) ?? 0) + 1)
    return m
  }, [planned])

  const selected = ok.filter((p) => checked.has(p.rec.id))
  const before = selected.reduce((n, p) => n + p.rec.size, 0)
  const after = selected.reduce((n, p) => n + (p.plan.ok ? p.plan.estimate : 0), 0)

  const toggle = (id: string) =>
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function start() {
    setPhase('running')
    // The window stays open (it shows each file's result); it is removed when closed.
    set({ compressOutcome: {} })
    if (props.mode === 'offer') await decline(ok.filter((p) => !checked.has(p.rec.id)).map((p) => p.rec.id))
    setResult(await compressNow(selected))
    setPhase('done')
  }

  const close = () => {
    if (props.mode === 'offer' && phase === 'choose') postpone(ok.map((p) => p.rec.id))
    props.onClose()
  }

  const rowStatus = (p: Planned) => {
    const o = outcomes[p.rec.id]
    if (phase === 'choose' || !checked.has(p.rec.id)) {
      return p.plan.ok ? <>≈ {fmt.bytes(p.plan.estimate)} <span className="pct">−{fmt.percent(1 - p.plan.estimate / p.rec.size)}</span></> : null
    }
    if (!o || o.status === 'pending') {
      return compressing?.name === p.rec.name ? (
        <>
          <Loader2 size={14} className="spin" /> {fmt.percent(compressing.fileProgress)}
        </>
      ) : (
        <span className="hint">{t('compress.waiting')}</span>
      )
    }
    if (o.status === 'done')
      return (
        <span className="ok-text">
          <Check size={14} /> {fmt.bytes(o.after)} <span className="pct">−{fmt.percent(1 - o.after / p.rec.size)}</span>
        </span>
      )
    if (o.status === 'nogain') return <span className="hint">{t('compress.keptUnchanged')}</span>
    return (
      <span className="error-text">
        <X size={14} /> {t('compress.failed')}
      </span>
    )
  }

  return (
    <Modal wide title={props.title} onClose={close}>
      {!planned && <p>{t('compress.planning', { count: initialItems.length })}</p>}

      {planned && ok.length === 0 && <p>{t('compress.nothing')}</p>}

      {planned && ok.length > 0 && (
        <>
          {phase === 'choose' && <p>{t(props.mode === 'offer' ? 'compress.offerIntro' : 'compress.chooseIntro')}</p>}
          {phase === 'choose' && ok.length > 1 && (
            <div className="row" style={{ marginBlockEnd: 6 }}>
              <button className="btn ghost" onClick={() => setChecked(new Set(ok.map((p) => p.rec.id)))}>
                {t('compress.selectAll')}
              </button>
              <button className="btn ghost" onClick={() => setChecked(new Set())}>
                {t('compress.selectNone')}
              </button>
            </div>
          )}
          <ul className="compress-list">
            {ok.map((p) => (
              <li key={p.rec.id} className={checked.has(p.rec.id) ? '' : 'off'}>
                <label>
                  <input type="checkbox" checked={checked.has(p.rec.id)} disabled={phase !== 'choose'} onChange={() => toggle(p.rec.id)} />
                  <SmallThumb rec={p.rec} />
                  <span className="name" title={p.rec.name}>
                    <bdi>{p.rec.name}</bdi>
                  </span>
                </label>
                <span className="sizes">
                  {fmt.bytes(p.rec.size)} → {rowStatus(p)}
                </span>
              </li>
            ))}
          </ul>
          {phase === 'choose' && (
            <p>
              <strong>
                {t('compress.selection', { count: selected.length })}: {fmt.bytes(before)} → ≈ {fmt.bytes(after)}
              </strong>{' '}
              {selected.length > 0 && t('compress.savedEstimate', { saved: fmt.bytes(before - after) })}
            </p>
          )}
          {phase === 'choose' && <p className="hint">{t(`compress.keepHint.${useApp.getState().settings.compress.keepOriginal}`)}</p>}
          {phase === 'choose' && props.mode === 'offer' && <p className="hint">{t('compress.uncheckedHint')}</p>}
          {phase === 'running' && <p className="hint">{t('compress.background')}</p>}
          {phase === 'done' && result && <p><strong>{t('compress.done', { count: result.count, saved: fmt.bytes(result.saved) })}</strong></p>}
        </>
      )}

      {planned && skipped.size > 0 && phase === 'choose' && (
        <ul className="hint">
          {REASONS.filter((r) => skipped.has(r)).map((r) => (
            <li key={r}>{t(`compress.skip.${r}`, { count: skipped.get(r) })}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        {phase === 'choose' && (
          <>
            <button className="btn" onClick={close}>
              {t(props.mode === 'offer' ? 'compress.later' : 'common.cancel')}
            </button>
            {ok.length > 0 && (
              <button className="btn primary" disabled={!selected.length} onClick={start}>
                {t('compress.startN', { count: selected.length })}
              </button>
            )}
          </>
        )}
        {phase === 'running' && (
          <button className="btn" onClick={props.onClose}>
            {t('common.close')}
          </button>
        )}
        {phase === 'done' && (
          <button className="btn primary" onClick={props.onClose}>
            {t('common.ok')}
          </button>
        )}
      </div>
    </Modal>
  )
}
