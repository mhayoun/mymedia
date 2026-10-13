import { Download, HandCoins, Loader2, Store, Trash2, Upload, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { classifyPending } from '../classify/engine'
import { LOCALES } from '../i18n'
import { useFormat } from '../i18n/format'
import { buildModel, installedModels, installModel, ModelError, removeModel, type InstalledModel, type InstallStep } from '../models/references'
import {
  buyModel,
  capturePayment,
  markPaidOut,
  mySales,
  payouts,
  publishModel,
  shopModels,
  ShopError,
  withdrawModel,
  type Amounts,
  type MySales,
  type Payout,
  type ShopModel,
} from '../models/shop'
import { app, useApp, type Language } from '../store'
import { Modal } from './Dialog'
import { useLibraryContext } from './libraryContext'

const CURRENCIES = ['ILS', 'EUR', 'USD']

/** Rough share of the whole install: the albums take most of it. */
function percentOf(p: { step: InstallStep; done: number; total: number }): number {
  if (p.step === 'download') return 3
  if (p.step === 'albums') return 5 + Math.round((80 * p.done) / Math.max(p.total, 1))
  return p.step === 'save' ? 88 : 95
}

/** Settings → classification models: the shop, the installed models, publishing one's own. */
export function ModelsDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const lib = useLibraryContext()
  const user = useApp((s) => s.user)
  const [shop, setShop] = useState<ShopModel[] | null>(null)
  const [paymentsLive, setPaymentsLive] = useState(false)
  const [fee, setFee] = useState(0)
  const [sales, setSales] = useState<MySales | null>(null)
  const [owed, setOwed] = useState<Payout[] | null>(null)
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [install, setInstall] = useState<{ step: InstallStep; done: number; total: number } | null>(null)

  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [seller, setSeller] = useState(user?.name ?? '')
  const [paypal, setPaypal] = useState(user?.email ?? '')
  const [price, setPrice] = useState('0')
  const [currency, setCurrency] = useState('ILS')

  const money = (amount: number, cur: string) =>
    new Intl.NumberFormat(LOCALES[i18n.language as Language] ?? 'en-US', { style: 'currency', currency: cur }).format(amount)
  const amounts = (a: Amounts) => Object.entries(a).map(([cur, n]) => money(n, cur)).join(' + ') || '—'

  const refresh = useCallback(() => {
    shopModels()
      .then((r) => {
        setShop(r.models)
        setPaymentsLive(r.paymentsLive)
        setFee(r.fee)
        if (r.admin) payouts().then(setOwed, (e) => console.error('[MyMedia] payouts not read', e))
      })
      .catch((e) => {
        console.error('[MyMedia] shop not read', e)
        setShop([])
        setError(t('models.shopUnreachable'))
      })
    installedModels().then(setInstalled)
    mySales().then(setSales, () => setSales(null))
  }, [t])
  useEffect(refresh, [refresh])

  const message = (e: unknown) => {
    console.error('[MyMedia] models', e)
    if (e instanceof ModelError) return t(`models.error.${e.code}`)
    if (e instanceof ShopError && e.status === 401) return t('models.error.signIn')
    if (e instanceof ShopError && e.status === 413) return t('models.error.tooBig')
    if (e instanceof ShopError && e.status === 402) return t('models.error.notPaid')
    if (e instanceof ShopError && e.status === 409) return t('models.error.noPaypal')
    if (e instanceof ShopError && e.status === 502) return t('models.error.paypal')
    return t('errors.generic', { message: (e as Error).message })
  }

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    setError(null)
    setDone(null)
    try {
      setDone(await fn())
      refresh()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }

  const installNow = async (id: string) => {
    const got = await installModel(id, (step, n, total) => setInstall({ step, done: n, total })).finally(() => setInstall(null))
    void classifyPending()
    return t('models.installed', { name: got.name, count: got.albums.length })
  }

  const get = (id: string) =>
    act(id, async () => {
      const r = await buyModel(id)
      if (r.approve) {
        // Paid: on to PayPal, which sends the buyer back here to finish.
        setDone(t('models.toPaypal'))
        location.assign(r.approve)
        await new Promise(() => undefined)
      }
      return installNow(id)
    })

  // Back from PayPal: take the payment, then install.
  const resumed = useRef(false)
  useEffect(() => {
    const back = app().shopResume
    if (!back || resumed.current) return
    resumed.current = true
    app().set({ shopResume: null })
    if (back.cancelled) setError(t('models.paymentCancelled'))
    else
      void act(back.model, async () => {
        await capturePayment(back.model, back.order)
        return installNow(back.model)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installedIds = new Set((installed ?? []).map((m) => m.id))
  const categories = lib?.categories.filter((c) => c.children.length > 0) ?? []
  const priceValue = Number(price.replace(',', '.'))
  const paypalOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypal.trim())
  const share = Math.round(priceValue * (100 - fee)) / 100
  const canPublish = !!categoryId && !!name.trim() && !!seller.trim() && Number.isFinite(priceValue) && priceValue >= 0 && (priceValue === 0 || paypalOk)

  return (
    <Modal wide title={t('models.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        <p className="hint">{t('models.intro')}</p>

        <h3>
          <Download size={16} /> {t('models.installedTitle')}
        </h3>
        {installed === null ? (
          <p className="hint">
            <Loader2 size={14} className="spin" />
          </p>
        ) : installed.length === 0 ? (
          <p className="hint">{t('models.noneInstalled')}</p>
        ) : (
          installed.map((m) => (
            <div key={m.id} className="model-row">
              <div>
                <strong>
                  <bdi>{m.name}</bdi>
                </strong>
                <div className="hint">
                  {t('models.bySeller', { seller: m.seller })} · <bdi>{m.category}</bdi> · {t('models.albums', { count: m.albums.length })} ·{' '}
                  {t('models.examples', { count: m.labels.length })}
                </div>
              </div>
              <button className="btn ghost" disabled={!!busy} onClick={() => act(m.id, async () => (await removeModel(m.id), t('models.removed')))}>
                <Trash2 size={16} /> {t('models.remove')}
              </button>
            </div>
          ))
        )}

        <h3>
          <Store size={16} /> {t('models.shopTitle')}
        </h3>
        {shop === null ? (
          <p className="hint">
            <Loader2 size={14} className="spin" /> {t('models.loading')}
          </p>
        ) : shop.length === 0 ? (
          <p className="hint">{t('models.shopEmpty')}</p>
        ) : (
          shop.map((m) => (
            <div key={m.id} className="model-row">
              <div>
                <strong>
                  <bdi>{m.name}</bdi>
                </strong>{' '}
                <span className="tag">{m.price > 0 ? money(m.price, m.currency) : t('models.free')}</span>
                <div className="hint">
                  {t('models.bySeller', { seller: m.seller })} · <bdi>{m.category}</bdi> · {t('models.albums', { count: m.albums })} ·{' '}
                  {t('models.examples', { count: m.examples })} · {fmt.date(m.createdAt)}
                </div>
                {m.description && <div dir="auto">{m.description}</div>}
                {busy === m.id && install && (
                  <div className="model-progress">
                    <progress max={100} value={percentOf(install)} />
                    <span className="hint">
                      {t(`models.step.${install.step}`, { done: fmt.number(install.done), total: fmt.number(install.total) })} — {fmt.percent(percentOf(install) / 100)}
                    </span>
                  </div>
                )}
              </div>
              <span className="row">
                {m.mine ? (
                  <span className="tag">{t('models.isMine')}</span>
                ) : installedIds.has(m.id) ? (
                  <span className="ok-text">{t('models.isInstalled')}</span>
                ) : (
                  <button
                    className="btn primary"
                    disabled={!!busy}
                    onClick={() => get(m.id)}
                  >
                    {busy === m.id ? <Loader2 size={16} className="spin" /> : <Download size={16} />}{' '}
                    {m.owned || m.price === 0 ? t('models.get') : m.paymentsLive ? t('models.buy', { price: money(m.price, m.currency) }) : t('models.getFreeTest')}
                  </button>
                )}
                {m.mine && (
                  <button
                    className="btn ghost"
                    disabled={!!busy}
                    onClick={() => act(`w${m.id}`, async () => (await withdrawModel(m.id), t('models.withdrawn')))}
                    title={t('models.withdraw')}
                  >
                    <Trash2 size={16} /> {t('models.withdraw')}
                  </button>
                )}
              </span>
            </div>
          ))
        )}

        {sales && sales.count > 0 && (
          <>
            <h3>
              <Wallet size={16} /> {t('models.salesTitle')}
            </h3>
            <p>{t('models.salesLine', { count: sales.count, owed: amounts(sales.owed), paid: amounts(sales.paidOut) })}</p>
            <p className="hint">{t('models.salesHint', { fee: sales.fee })}</p>
          </>
        )}

        <h3>
          <Upload size={16} /> {t('models.publishTitle')}
        </h3>
        <p className="hint">{t('models.publishHint')}</p>
        <label className="field">
          {t('models.category')}
          <select
            value={categoryId}
            disabled={!!busy}
            onChange={(e) => {
              setCategoryId(e.target.value)
              if (!name) setName(categories.find((c) => c.id === e.target.value)?.name ?? '')
            }}
          >
            <option value="">{t('models.chooseCategory')}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({t('models.albums', { count: c.children.length })})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('models.name')}
          <input type="text" dir="auto" value={name} maxLength={80} disabled={!!busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          {t('models.description')}
          <input type="text" dir="auto" value={description} maxLength={500} disabled={!!busy} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          {t('models.seller')}
          <input type="text" dir="auto" value={seller} maxLength={80} disabled={!!busy} onChange={(e) => setSeller(e.target.value)} />
        </label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            {t('models.price')}
            <input type="number" min={0} step="any" inputMode="decimal" dir="ltr" value={price} disabled={!!busy} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            {t('models.currency')}
            <select value={currency} disabled={!!busy} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {priceValue > 0 && (
          <label className="field">
            {t('models.paypal')}
            <input type="email" dir="ltr" value={paypal} maxLength={120} disabled={!!busy} onChange={(e) => setPaypal(e.target.value)} />
          </label>
        )}
        {paymentsLive && priceValue > 0 && (
          <p className="ok-text">{t('models.youGet', { share: money(share, currency), price: money(priceValue, currency), fee })}</p>
        )}
        <p className="hint">{t(paymentsLive ? 'models.priceHintLive' : 'models.priceHint', { fee })}</p>
        <button
          className="btn primary"
          disabled={!!busy || !canPublish}
          onClick={() =>
            act('publish', async () => {
              const built = await buildModel(categoryId)
              const { photos: _, left, ...data } = built
              const m = await publishModel({ ...data, name: name.trim(), description: description.trim(), seller: seller.trim(), paypal: priceValue > 0 ? paypal.trim() : '', price: priceValue, currency })
              const msg = t('models.published', { name: m.name, albums: m.albums, count: m.examples })
              return left.length ? `${msg} ${t('models.leftOut', { count: left.length, names: left.join(', ') })}` : msg
            })
          }
        >
          {busy === 'publish' ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {t('models.publish')}
        </button>

        {owed && (
          <>
            <h3>
              <HandCoins size={16} /> {t('models.payoutsTitle')}
            </h3>
            <p className="hint">{t('models.payoutsHint')}</p>
            {owed.length === 0 ? (
              <p className="hint">{t('models.payoutsNone')}</p>
            ) : (
              owed.map((p) => (
                <div key={`${p.sellerEmail}-${p.currency}`} className="model-row">
                  <div>
                    <strong>{money(p.amount, p.currency)}</strong> → <bdi>{p.seller}</bdi>
                    <div className="hint">
                      PayPal <bdi className="selectable">{p.paypal}</bdi> · {t('models.payoutSales', { count: p.orders.length, fees: money(p.fees, p.currency) })} ·{' '}
                      {t('models.payoutSince', { date: fmt.date(p.oldest) })}
                    </div>
                  </div>
                  <button
                    className="btn ghost"
                    disabled={!!busy}
                    onClick={() =>
                      act(`p${p.sellerEmail}${p.currency}`, async () => {
                        await markPaidOut(p.orders)
                        return t('models.paidOutDone', { amount: money(p.amount, p.currency), seller: p.seller })
                      })
                    }
                  >
                    {t('models.markPaidOut')}
                  </button>
                </div>
              ))
            )}
          </>
        )}

        {done && <p className="ok-text">{done}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  )
}
