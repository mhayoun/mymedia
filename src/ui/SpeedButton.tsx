import { Gauge, Loader2, Wifi, WifiHigh, WifiLow, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { speedLevel, type SpeedLevel } from '../lib/speed'
import { currentMbps, lastSpeed, subscribeSpeed, testSpeed } from '../sync/speed'
import { useApp } from '../store'
import { Modal } from './Dialog'
import { useOnline } from './hooks'

const ICONS: Record<SpeedLevel, typeof Wifi> = { offline: WifiOff, unknown: Wifi, slow: WifiLow, medium: WifiHigh, good: Wifi }

/** The header's Wi-Fi icon: the internet speed level; it opens the speed test. */
export function SpeedButton() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const online = useOnline()
  const mbps = useSyncExternalStore(subscribeSpeed, currentMbps)
  const set = useApp((s) => s.set)
  const level = speedLevel(mbps, online)
  const Icon = ICONS[level]
  const title = `${t(`speed.level.${level}`)}${online && mbps !== null ? ` · ${t('speed.mbps', { value: fmt.number(Math.round(mbps * 10) / 10) })}` : ''}`
  return (
    <button className={`icon-btn speed-btn ${level}`} onClick={() => set({ speedOpen: true })} aria-label={title} title={title}>
      <Icon />
    </button>
  )
}

export function SpeedDialog({ onClose }: { onClose: () => void }) {
  const online = useOnline()
  const { t } = useTranslation()
  const fmt = useFormat()
  const result = useSyncExternalStore(subscribeSpeed, lastSpeed)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const run = async () => {
    abort.current = new AbortController()
    setError(false)
    setProgress(0)
    try {
      await testSpeed(setProgress, abort.current.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.warn('[MyMedia] speed test', e)
        setError(true)
      }
    } finally {
      setProgress(null)
    }
  }

  const level = speedLevel(currentMbps() ?? result?.down ?? null, online)
  // `npm run dev`: the file comes from this computer, the speed means nothing.
  const local = ['localhost', '127.0.0.1'].includes(location.hostname)
  return (
    <Modal title={t('speed.title')} onClose={onClose}>
      {result && progress === null && (
        <p className="speed-value">
          {t('speed.mbps', { value: fmt.number(Math.round(result.down)) })}
          <span className="hint"> · {fmt.time(result.at)}</span>
        </p>
      )}
      <p className={`speed-level ${level}`}>{t(`speed.meaning.${level}`)}</p>
      {progress !== null && <progress max={1} value={progress} style={{ inlineSize: '100%' }} />}
      {error && <p className="error-text">{t('speed.failed')}</p>}
      {local && <p className="hint">{t('speed.local')}</p>}
      <div className="actions">
        <button className="btn ghost" onClick={onClose}>
          {t('common.close')}
        </button>
        <button className="btn primary" onClick={() => void run()} disabled={!online || progress !== null}>
          {progress !== null ? <Loader2 size={16} className="spin" /> : <Gauge size={16} />} {t(progress !== null ? 'speed.testing' : 'speed.test')}
        </button>
      </div>
    </Modal>
  )
}
