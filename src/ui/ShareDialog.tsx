import { Eye, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listPermissions, removePermission, shareAsReader, type Permission } from '../drive/api'
import { useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'
import { SharedLibraries } from './SharedLibraries'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Share: who sees the user's MyMedia (read-only, by Google account). View: the MyMedia shared with them. */
export function ShareDialog({ mode, onClose }: { mode: 'share' | 'view'; onClose: () => void }) {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)
  const shared = useApp((s) => s.shared)
  const readOnly = useApp((s) => s.readOnly)
  const [people, setPeople] = useState<Permission[] | null>(null)
  const [email, setEmail] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Permission | null>(null)

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
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await shareAsReader(rootId!, to, notify)
      setDone(t('share.done', { email: to, site: location.host }))
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
            <button className="btn primary" onClick={() => void share()} disabled={busy || !rootId || !email.trim()}>
              {busy ? <Loader2 size={16} className="spin" /> : <Eye size={16} />} {t('share.submit')}
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
          {done && <p className="hint">{done}</p>}

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
