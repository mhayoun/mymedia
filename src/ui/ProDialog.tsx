import { Crown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LOCALES } from '../i18n'
import { useFormat } from '../i18n/format'
import { buyPro, capturePro, FREE_SHARES, fullProjectFor, loadPro, type ProPlan } from '../models/pro'
import { ShopError } from '../models/shop'
import { auth } from '../auth/google'
import { isNative } from '../native'
import { app, useApp, type Language } from '../store'
import { Modal } from './Dialog'

/** MyMedia Pro: what it unlocks, this account's status, and buying it (web site: PayPal). */
export function ProDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const user = useApp((s) => s.user)
  const pro = useApp((s) => s.pro)
  const door = useApp((s) => s.door)
  const [busy, setBusy] = useState<ProPlan | 'resume' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const resumed = useRef(false)

  const money = (amount: number, cur: string) =>
    new Intl.NumberFormat(LOCALES[i18n.language as Language] ?? 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)
  const message = (e: unknown) => {
    if (e instanceof ShopError && e.status === 502) return t('models.error.paypal')
    if (e instanceof ShopError && e.status === 402) return t('pro.notPaid')
    return t('errors.generic', { message: (e as Error).message })
  }

  useEffect(() => {
    if (user) void loadPro(user.email)
  }, [user])

  // Back from PayPal: take the payment.
  useEffect(() => {
    const back = app().proResume
    if (!back || !user || resumed.current) return
    resumed.current = true
    app().set({ proResume: null })
    if (back.cancelled) return setError(t('models.paymentCancelled'))
    setBusy('resume')
    capturePro(user.email, back.order)
      .then(() => setDone(true))
      .catch((e) => setError(message(e)))
      .finally(() => setBusy(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function buy(plan: ProPlan) {
    if (!user) return
    setBusy(plan)
    setError(null)
    try {
      const { approve } = await buyPro(user.email, plan)
      // PayPal's page; it sends the buyer back to MyMedia.
      if (approve) return location.assign(approve)
      setDone(true)
    } catch (e) {
      setError(message(e))
    }
    setBusy(null)
  }

  const plan = (id: ProPlan) => pro?.plans.find((p) => p.id === id)
  const year = plan('year')
  const life = plan('life')

  return (
    <Modal title={t('pro.title')} onClose={() => busy !== 'resume' && onClose()}>
      <div className="modal-scroll">
        <p className="pro-status">
          <Crown size={18} />{' '}
          <strong>
            {!pro?.pro
              ? t('pro.statusFree')
              : pro.offered
                ? t('pro.statusOffered')
                : pro.life
                  ? t('pro.statusLife')
                : t('pro.statusUntil', { date: fmt.date(pro.until ?? undefined) })}
          </strong>
        </p>
        {done && <p className="hint">{t('pro.thanks')}</p>}

        <h3>{t('pro.includes')}</h3>
        <ul className="pro-features">
          <li>{t('pro.featureShare', { count: FREE_SHARES })}</li>
          <li>{t('pro.featureTransfer')}</li>
          <li>{t('pro.featureDrive')}</li>
          <li>{t('pro.featureDates')}</li>
        </ul>
        <p className="hint">{t('pro.freeRest')}</p>
        {pro?.pro && door === 'free' && !isNative && <FullAccessButton />}

        {busy === 'resume' ? (
          <p className="hint">
            <Loader2 size={14} className="spin" /> {t('pro.capturing')}
          </p>
        ) : isNative ? (
          !pro?.pro && <p className="hint">{t('pro.androidSoon')}</p>
        ) : (
          !pro?.life && (
            <>
              <h3>{pro?.pro ? t('pro.extendTitle') : t('pro.buyTitle')}</h3>
              {!pro && (
                <p className="hint">
                  <Loader2 size={14} className="spin" />
                </p>
              )}
              <div className="pro-plans">
                {year && (
                  <button className="btn pro-plan" disabled={!!busy} onClick={() => void buy('year')}>
                    {busy === 'year' && <Loader2 size={16} className="spin" />}
                    <strong>{t('pro.planYear', { perMonth: money(year.price / 12, year.currency) })}</strong>
                    <span className="hint">{t('pro.planYearHint', { price: money(year.price, year.currency) })}</span>
                  </button>
                )}
                {life && (
                  <button className="btn primary pro-plan" disabled={!!busy} onClick={() => void buy('life')}>
                    {busy === 'life' && <Loader2 size={16} className="spin" />}
                    <strong>{t('pro.planLife', { price: money(life.price, life.currency) })}</strong>
                    <span className="hint">{t('pro.planLifeHint')}</span>
                  </button>
                )}
              </div>
              <p className="hint">{t('pro.paypalHint')}</p>
              {pro?.test && <p className="hint">{t('pro.testMoney')}</p>}
            </>
          )
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy === 'resume'}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}

/**
 * In place of a Pro feature, for a free account. `needsFull`: the feature also needs the full Drive access
 * (MyMedia's full door), which a Pro account opened by the free door gives here with one click.
 */
export function ProGate({ feature, needsFull = false }: { feature: string; needsFull?: boolean }) {
  const { t } = useTranslation()
  const isPro = useApp((s) => !!s.pro?.pro)
  if (isPro && needsFull) return <FullAccessButton feature={feature} />
  return (
    <div className="pro-gate">
      <Crown size={28} />
      <p>{t('pro.gate', { feature })}</p>
      {needsFull && <p className="hint">{t('door.proNeedsFull')}</p>}
      <button className="btn primary" onClick={() => app().set({ proOpen: true, sidebarOpen: false, accountOpen: false })}>
        <Crown size={16} /> {t('pro.discover')}
      </button>
    </div>
  )
}

/** A Pro account opened by the free door: gives the full Drive access (Google's window, then the app starts again). */
export function FullAccessButton({ feature }: { feature?: string }) {
  const { t } = useTranslation()
  const user = useApp((s) => s.user)
  return (
    <div className="pro-gate">
      <Crown size={28} />
      <p>{feature ? t('door.gate', { feature }) : t('door.grantTitle')}</p>
      <p className="hint">{t('door.warning')}</p>
      <button className="btn primary" onClick={() => user && auth.upgrade(user.email, fullProjectFor())}>
        {t('door.grant')}
      </button>
    </div>
  )
}
