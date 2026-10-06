import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { compressNow, planMany, type Planned } from '../compress/engine'
import type { MediaRecord } from '../db/db'
import { useFormat } from '../i18n/format'
import type { SkipReason } from '../lib/compressPlan'
import { useApp } from '../store'
import { Modal } from './Dialog'

interface Props {
  title: string
  items: MediaRecord[]
  onClose: () => void
}

const REASONS: SkipReason[] = ['alreadyCompressed', 'compressedByApp', 'tooSmall', 'noGain', 'videoNotHere', 'format']

/** Manual compression: estimate first, then compress with progress, then the real saving. */
export function CompressDialog({ title, items: initialItems, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const compressing = useApp((s) => s.compressing)
  const keepOriginal = useApp((s) => s.settings.compress.keepOriginal)
  const [planned, setPlanned] = useState<Planned[] | null>(null)
  const [result, setResult] = useState<{ count: number; saved: number } | null>(null)
  const [started, setStarted] = useState(false)
  // The list is fixed when the dialog opens (the library changes while compressing).
  const [items] = useState(initialItems)

  useEffect(() => {
    let alive = true
    planMany(items, 'manual').then((p) => alive && setPlanned(p))
    return () => {
      alive = false
    }
  }, [items])

  const summary = useMemo(() => {
    if (!planned) return null
    const ok = planned.filter((p) => p.plan.ok)
    const before = ok.reduce((n, p) => n + p.rec.size, 0)
    const after = ok.reduce((n, p) => n + (p.plan.ok ? p.plan.estimate : 0), 0)
    const skipped = new Map<SkipReason, number>()
    for (const p of planned) if (!p.plan.ok) skipped.set(p.plan.reason, (skipped.get(p.plan.reason) ?? 0) + 1)
    return { ok, before, after, skipped }
  }, [planned])

  async function start() {
    if (!planned) return
    setStarted(true)
    setResult(await compressNow(planned))
  }

  return (
    <Modal title={title} onClose={onClose}>
      {!summary && <p>{t('compress.planning', { count: items.length })}</p>}
      {summary && !started && (
        <>
          {summary.ok.length > 0 ? (
            <>
              <p>{t('compress.toDo', { count: summary.ok.length })}</p>
              <p>
                {t('compress.estimate', {
                  before: fmt.bytes(summary.before),
                  after: fmt.bytes(summary.after),
                  saved: fmt.bytes(summary.before - summary.after),
                })}
              </p>
              <p className="hint">{t(`compress.keepHint.${keepOriginal}`)}</p>
            </>
          ) : (
            <p>{t('compress.nothing')}</p>
          )}
          {summary.skipped.size > 0 && (
            <ul className="hint">
              {REASONS.filter((r) => summary.skipped.has(r)).map((r) => (
                <li key={r}>{t(`compress.skip.${r}`, { count: summary.skipped.get(r) })}</li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            {summary.ok.length > 0 && (
              <button className="btn primary" onClick={start}>
                {t('compress.start')}
              </button>
            )}
          </div>
        </>
      )}
      {started && !result && (
        <>
          <p>
            {compressing
              ? t('compress.progress', { done: compressing.done + 1, total: compressing.total })
              : t('common.loading')}
          </p>
          {compressing && (
            <>
              <p className="hint">
                <bdi>{compressing.name}</bdi> — {fmt.percent(compressing.fileProgress)}
              </p>
              <progress max={1} value={(compressing.done + compressing.fileProgress) / Math.max(1, compressing.total)} style={{ inlineSize: '100%' }} />
              {compressing.saved > 0 && <p>{t('compress.savedSoFar', { saved: fmt.bytes(compressing.saved) })}</p>}
            </>
          )}
          <p className="hint">{t('compress.background')}</p>
          <div className="actions">
            <button className="btn" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}
      {result && (
        <>
          <p>{t('compress.done', { count: result.count, saved: fmt.bytes(result.saved) })}</p>
          <div className="actions">
            <button className="btn primary" onClick={onClose}>
              {t('common.ok')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
