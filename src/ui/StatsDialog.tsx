import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { labeledSet, loadData } from '../classify/data'
import { db } from '../db/db'
import { useFormat } from '../i18n/format'
import type { LabelStats } from '../lib/classifier'
import { placementOf } from '../lib/tree'
import { calibrateTau, evaluateSet } from '../ml/ml'
import { useApp } from '../store'
import { Modal } from './Dialog'
import type { Library } from './useLibrary'

interface Result {
  media: number
  learned: number
  failed: number
  stats: LabelStats[]
}

/** Learning statistics: accuracy per album, albums needing examples, confusions. */
export function StatsDialog({ lib }: { lib: Library }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const set = useApp((s) => s.set)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const data = await loadData(rootId)
      const failed = (await db().embeddings.toArray()).filter((e) => e.failed).length
      const { set: packed } = labeledSet(data)
      let stats: LabelStats[] = []
      if (packed.ids.length >= 2) stats = await evaluateSet(packed, await calibrateTau(packed))
      if (alive) setResult({ media: data.media.length, learned: data.vecs.size, failed, stats })
    })().catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [rootId])

  const name = (folderId: string) => {
    const p = placementOf(folderId, lib.folders, rootId)
    return [p.category, p.album].filter(Boolean).join(' / ')
  }
  const sorted = [...(result?.stats ?? [])].sort((a, b) => {
    const ra = a.tested ? a.correct / a.tested : 2
    const rb = b.tested ? b.correct / b.tested : 2
    return ra - rb || a.examples - b.examples
  })
  const few = sorted.filter((s) => s.examples < 3)
  const tested = sorted.filter((s) => s.tested > 0)
  const overall = tested.reduce((n, s) => n + s.correct, 0) / Math.max(1, tested.reduce((n, s) => n + s.tested, 0))

  return (
    <Modal wide title={t('stats.title')} onClose={() => set({ statsOpen: false })}>
      <div className="modal-scroll">
        {error && <p className="error-text">{error}</p>}
        {!result && !error && <p>{t('stats.computing')}</p>}
        {result && (
          <>
            <p>
              {t('stats.learned', { learned: fmt.number(result.learned), total: fmt.number(result.media) })}
              {result.failed > 0 && <> · {t('stats.failed', { count: result.failed })}</>}
            </p>
            {tested.length > 0 && <p>{t('stats.overall', { percent: fmt.percent(overall) })}</p>}
            {few.length > 0 && (
              <>
                <h3>{t('stats.fewTitle', { count: few.length })}</h3>
                <p className="hint">{t('stats.fewHint')}</p>
                <p>
                  {few.map((s, i) => (
                    <span key={s.label}>
                      {i > 0 && ', '}
                      <bdi>{name(s.label)}</bdi> ({s.examples})
                    </span>
                  ))}
                </p>
              </>
            )}
            {tested.length > 0 && (
              <>
                <h3>{t('stats.perAlbum')}</h3>
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>{t('viewer.album')}</th>
                      <th>{t('stats.examples')}</th>
                      <th>{t('stats.accuracy')}</th>
                      <th>{t('stats.confused')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tested.map((s) => (
                      <tr key={s.label}>
                        <td>
                          <bdi>{name(s.label)}</bdi>
                        </td>
                        <td className="num">{fmt.number(s.examples)}</td>
                        <td className="num">{fmt.percent(s.correct / s.tested)}</td>
                        <td>
                          {s.confusedWith ? (
                            <>
                              <bdi>{name(s.confusedWith)}</bdi> ({s.confusedCount})
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
