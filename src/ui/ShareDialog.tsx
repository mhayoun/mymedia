import { Copy, Crown, Eye, Link2, Loader2, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listPermissions, removePermission, shareAsReader, shareWithLink, type Permission } from '../drive/api'
import { publicLink } from '../lib/publicLink'
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
  const [linkBusy, setLinkBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  // Shared by a link: anyone who has it sees the library, without signing in (free, no place taken).
  const linkPerm = people?.find((p) => p.type === 'anyone') ?? null
  const persons = people?.filter((p) => p.type !== 'anyone') ?? null
  const link = rootId ? publicLink(rootId) : ''
  // Free: up to FREE_SHARES people (those already there stay).
  const full = !isPro && !!persons && persons.filter((p) => p.type === 'user').length >= FREE_SHARES

  async function createLink() {
    setLinkBusy(true)
    setError(null)
    try {
      await shareWithLink(rootId!)
      await load()
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    } finally {
      setLinkBusy(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused: the link stays shown, to copy by hand.
    }
  }

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
          <h3>
            <Link2 size={16} /> {t('share.linkTitle')}
          </h3>
          <p className="hint">{t('share.linkIntro')}</p>
          {!people && !error ? (
            <Loader2 size={16} className="spin" />
          ) : linkPerm ? (
            <>
              <input className="share-link" type="text" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} />
              <div className="actions">
                <button className="btn primary" onClick={() => void copyLink()}>
                  <Copy size={16} /> {copied ? t('share.linkCopied') : t('share.linkCopy')}
                </button>
                <a
                  className="btn"
                  href={`https://wa.me/?text=${encodeURIComponent(t('share.linkWhatsappText', { owner: user?.name || user?.email || '', link }))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle size={16} /> {t('share.whatsapp')}
                </a>
                <button className="btn" onClick={() => setStopping(true)}>
                  {t('share.linkStop')}
                </button>
              </div>
              <p className="hint">{t('share.linkWarning')}</p>
            </>
          ) : (
            <div className="actions">
              <button className="btn primary" onClick={() => void createLink()} disabled={linkBusy || !rootId}>
                {linkBusy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />} {t('share.linkCreate')}
              </button>
            </div>
          )}
        </section>
      )}
      {mode === 'share' && !shared && (
        <section>
          <h3>{t('share.mineTitle')}</h3>
          <p className="hint">{t(isPro ? 'share.introPro' : 'share.intro')}</p>
          {!full && <label className="field">
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
          </label>}
          {!full && <label className="radio-row">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={busy} />
            {t('share.notify')}
          </label>}
          {!full && <div className="actions">
            <button className="btn primary" onClick={() => void share()} disabled={busy || !rootId || !email.trim() || full}>
              {busy ? <Loader2 size={16} className="spin" /> : <Eye size={16} />} {t('share.submit')}
            </button>
          </div>}
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
          {persons && !persons.length && <p className="hint">{t('share.nobody')}</p>}
          {persons?.map((p) => (
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

      {stopping && linkPerm && (
        <ConfirmDialog
          title={t('share.linkStopTitle')}
          text={t('share.linkStopText')}
          confirmLabel={t('share.linkStop')}
          danger
          onConfirm={async () => {
            await removePermission(rootId!, linkPerm.id)
            await load()
          }}
          onClose={() => setStopping(false)}
        />
      )}

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
