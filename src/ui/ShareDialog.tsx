import { Crown, Eye, Loader2, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listPermissions, removePermission, shareAsReader, type Permission } from '../drive/api'
import { FREE_SHARES, useIsPro } from '../models/pro'
import { app, useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'
import { SharedLibraries } from './SharedLibraries'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Share: who sees the user's MyMedia (read-only, by Google account). View: the MyMedia shared with them. */
export function ShareDialog({ mode, onClose }: { mode: 'share' | 'view'; onClose: () => void }) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)
  const shared = useApp((s) => s.shared)
  const readOnly = useApp((s) => s.readOnly)
  const user = useApp((s) => s.user)
  const [people, setPeople] = useState<Permission[] | null>(null)
  const [email, setEmail] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ text: string; email: string } | null>(null)
  const [removing, setRemoving] = useState<Permission | null>(null)
  const isPro = useIsPro()
  // Free: up to FREE_SHARES people (those already there stay).
  const full = !isPro && !!people && people.filter((p) => p.type === 'user').length >= FREE_SHARES

  const load = useCallback(async () => {
    if (!rootId || shared || mode !== 'share') return
    try {
      setPeople((await listPermissions(rootId)).filter((p) => p.role !== 'owner'))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
  }, [rootId, shared, mode, t])

  useEffect(() => {
    void load()
  }, [load])

  async function share() {
    const to = email.trim()
    if (!EMAIL.test(to)) return setError(t('share.invalid'))
    if (full) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await shareAsReader(rootId!, to, notify)
      setDone({ text: t('share.done', { email: to, site: location.host }), email: to })
      setEmail('')
      await load()
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  const who = (p: Permission) => p.displayName ?? p.emailAddress ?? (p.type === 'anyone' ? t('share.anyone') : p.type)

  return (
    <Modal title={t(mode === 'share' ? 'share.title' : 'share.viewTitle')} onClose={onClose}>
      {mode === 'view' && shared && (
        <section>
          <h3>{t('share.currentTitle')}</h3>
          <p className="hint">
            <bdi>{t(readOnly ? 'library.readOnlyHint' : 'library.sharedHint', { owner: shared.ownerName ?? shared.ownerEmail ?? '' })}</bdi>
          </p>
        </section>
      )}
      {mode === 'share' && !shared && (
        <section>
          <h3>{t('share.mineTitle')}</h3>
          <p className="hint">{t('share.intro')}</p>
          <label className="field">
            {t('share.email')}
            <input
              type="email"
              dir="ltr"
              placeholder="name@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void share()}
              disabled={busy || !rootId}
            />
          </label>
          <label className="radio-row">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} />
            {t('share.notify')}
          </label>
          <div className="actions">
            <button className="btn primary" onClick={() => void share()} disabled={busy || !rootId || !email.trim() || full}>
              {busy ? <Loader2 size={16} className="spin" /> : <Eye size={16} />} {t('share.submit')}
            </button>
          </div>
          {full && (
            <div className="row">
              <p className="hint" style={{ flex: 1 }}>
                {t('pro.shareFull', { count: FREE_SHARES })}
              </p>
              <button className="btn" onClick={() => app().set({ proOpen: true, shareOpen: false })}>
                <Crown size={16} /> {t('pro.discover')}
              </button>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          {done && (
            <div className="row">
              <p className="hint" style={{ flex: 1 }}>
                {done.text}
              </p>
              <WhatsAppButton email={done.email} owner={user?.name || user?.email || ''} label />
            </div>
          )}

          <h3>{t('share.people')}</h3>
          {!people && !error && <Loader2 size={16} className="spin" />}
          {people && !people.length && <p className="hint">{t('share.nobody')}</p>}
          {people?.map((p) => (
            <div key={p.id} className="check-row">
              <span style={{ flex: 1, minWidth: 0 }}>
                <bdi>{who(p)}</bdi>
                {p.displayName && p.emailAddress && (
                  <span className="hint" dir="ltr">
                    {' '}
                    {p.emailAddress}
                  </span>
                )}{' '}
                <span className="tag">{t(p.role === 'reader' || p.role === 'commenter' ? 'share.readOnly' : 'share.canEdit')}</span>
              </span>
              {p.emailAddress && <WhatsAppButton email={p.emailAddress} owner={user?.name || user?.email || ''} />}
              <button className="btn" onClick={() => setRemoving(p)}>
                {t('share.remove')}
              </button>
            </div>
          ))}
        </section>
      )}

      {mode === 'view' && (
        <section>
          <h3>{t('share.othersTitle')}</h3>
          <p className="hint">{t('share.viewIntro')}</p>
          <SharedLibraries />
        </section>
      )}

      <div className="actions">
        <button className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>

      {removing && (
        <ConfirmDialog
          title={t('share.removeTitle')}
          text={t('share.removeText', { who: who(removing) })}
          confirmLabel={t('share.remove')}
          danger
          onConfirm={async () => {
            await removePermission(rootId!, removing.id)
            await load()
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </Modal>
  )
}

/**
 * Opens WhatsApp with the explanation, in the sender's language, of how to open
 * their MyMedia (the sender chooses the contact in WhatsApp; nothing is sent by MyMedia).
 */
function WhatsAppButton({ email, owner, label = false }: { email: string; owner: string; label?: boolean }) {
  const { t } = useTranslation()
  const text = t('share.whatsappText', { owner, email, link: location.origin })
  return (
    <a
      className="btn"
      href={`https://wa.me/?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={t('share.whatsappHint')}
      aria-label={t('share.whatsapp')}
    >
      <MessageCircle size={16} /> {label && t('share.whatsapp')}
    </a>
  )
}
