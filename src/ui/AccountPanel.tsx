import { LogIn, LogOut, RefreshCw, Send, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { auth } from '../auth/google'
import { signOut } from '../session'
import { useApp } from '../store'
import { LibraryInfo } from './LibraryDialog'
import { TransferDialog } from './TransferDialog'

/** The Google account: who is signed in, reconnect, switch, sign out, and transfers to another account. */
export function AccountPanel() {
  const { t } = useTranslation()
  const user = useApp((s) => s.user)
  const rootId = useApp((s) => s.rootId)
  const shared = useApp((s) => s.shared)
  const set = useApp((s) => s.set)
  const [transfer, setTransfer] = useState(false)
  const close = () => set({ accountOpen: false })

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t('account.title')}>
        <header>
          <h2>{t('account.title')}</h2>
          <button className="icon-btn" onClick={close} aria-label={t('common.close')}>
            <X />
          </button>
        </header>

        <section>
          <div className="account-card">
            {user?.photo ? <img className="avatar big" src={user.photo} alt="" referrerPolicy="no-referrer" /> : <UserRound size={48} />}
            <div>
              {user?.name && <strong>{user.name}</strong>}
              {user && (
                <div className="hint" dir="ltr">
                  {user.email}
                </div>
              )}
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => auth.signIn()}>
              <RefreshCw size={16} /> {t('auth.reconnect')}
            </button>
            <button className="btn" onClick={() => auth.signIn(true)}>
              <LogIn size={16} /> {t('auth.switchAccount')}
            </button>
            <button className="btn" onClick={signOut}>
              <LogOut size={16} /> {t('auth.signOut')}
            </button>
          </div>
          <p className="hint">{t('account.reconnectHint')}</p>
        </section>

        <section>
          <h3>{t('library.title')}</h3>
          <LibraryInfo />
        </section>

        {!shared && (
          <section>
            <h3>{t('transfer.title')}</h3>
            <button className="btn" onClick={() => setTransfer(true)} disabled={!rootId}>
              <Send size={16} /> {t('transfer.open')}
            </button>
            <p className="hint">{t('transfer.settingsHint')}</p>
          </section>
        )}
      </aside>
      {transfer && <TransferDialog onClose={() => setTransfer(false)} />}
    </>
  )
}
