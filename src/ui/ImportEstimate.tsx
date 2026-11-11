import { HardDrive } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { storageQuota, type DriveQuota } from '../drive/api'
import { useFormat } from '../i18n/format'
import { importStats } from '../import/importTrack'
import { estimateImport, type Sizes } from '../lib/importPlan'

/** "≈ 3 h 20 min", "≈ 2 d 5 h": an import's time, rounded (it is an estimate). */
export function useApproxDuration() {
  const { t } = useTranslation()
  return (ms: number) => {
    const min = Math.max(1, Math.round(ms / 60_000))
    if (min < 60) return t('importEstimate.minutes', { m: min })
    const h = Math.floor(min / 60)
    if (h < 48) return t('importEstimate.hours', { h, m: min % 60 })
    return t('importEstimate.days', { d: Math.floor(h / 24), h: h % 24 })
  }
}

/** Files, size, Google Drive space needed after compression (and free), time to import. */
export function ImportEstimate({ sizes, label }: { sizes: Sizes; label?: string }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const duration = useApproxDuration()
  const [quota, setQuota] = useState<DriveQuota | null>(null)
  useEffect(() => {
    storageQuota().then(setQuota, () => setQuota(null))
  }, [])
  const est = estimateImport(sizes, true, importStats())
  const free = quota?.limit !== undefined ? Math.max(0, quota.limit - quota.usage) : null
  const missing = free !== null && est.driveBytes > free ? est.driveBytes - free : 0
  return (
    <div className="import-estimate">
      <p>
        <strong>{label ?? t('importEstimate.files', { count: sizes.files, files: fmt.number(sizes.files), size: fmt.bytes(sizes.bytes) })}</strong>
      </p>
      <ul>
        <li>
          {t('importEstimate.drive', { size: fmt.bytes(est.driveBytes) })}
          {free !== null && (
            <span className={missing ? 'error-text' : 'hint'}>
              {' '}
              <HardDrive size={13} /> {t('importEstimate.free', { size: fmt.bytes(free) })}
              {missing > 0 && <> — {t('importEstimate.missing', { size: fmt.bytes(missing) })}</>}
            </span>
          )}
        </li>
        <li>{t('importEstimate.time', { time: duration(est.ms) })}</li>
      </ul>
      <p className="hint">{t(est.measured ? 'importEstimate.measured' : 'importEstimate.guess')}</p>
    </div>
  )
}
