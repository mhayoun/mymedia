import { Download, Loader2, Send } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { acceptTransfer, findIncoming, sendFolder, TransferError, type IncomingTransfer, type TransferResult } from '../transfer/transfer'
import { Modal } from './Dialog'
import { useLibraryContext } from './libraryContext'
import type { FolderInfo } from './useLibrary'

type Busy = { done: number; total: number } | null

/** Settings → give a category or album to another Google account, or accept one. */
export function TransferDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const lib = useLibraryContext()
  const [folderId, setFolderId] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<IncomingTransfer[] | null>(null)

  useEffect(() => {
    findIncoming()
      .then(setIncoming)
      .catch((e) => {
        console.error('[MyMedia] transfers not read', e)
        setIncoming([])
      })
  }, [])

  const folders = useMemo(() => {
    const out: { id: string; label: string; count: number }[] = []
    const walk = (list: FolderInfo[], depth: number) => {
      for (const f of list) {
        out.push({ id: f.id, label: ' '.repeat(depth * 3) + f.name, count: f.count })
        walk(f.children, depth + 1)
      }
    }
    walk(lib?.categories ?? [], 0)
    return out
  }, [lib])
  const chosen = folders.find((f) => f.id === folderId)
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  const run = async (fn: () => Promise<TransferResult>, okKey: string) => {
    setError(null)
    setResult(null)
    setBusy({ done: 0, total: 0 })
    try {
      const r = await fn()
      const lines = [r.failed ? t('transfer.partly', { failed: r.failed, total: r.total, reason: r.reason ?? '?' }) : t(okKey, { count: r.total, email: email.trim() })]
      if (r.skipped) lines.push(t('transfer.skipped', { count: r.skipped, owners: r.otherOwners.join(', ') || '?' }))
      setResult(lines.join(' '))
    } catch (e) {
      console.error('[MyMedia] transfer failed', e)
      setError(
        e instanceof TransferError
          ? e.step === 'notOwner'
            ? t('transfer.notOwner', { name: e.detail, owner: e.owner ?? '?' })
            : t(`transfer.failed.${e.step}`, { message: e.detail })
          : t('errors.generic', { message: (e as Error).message }),
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal wide title={t('transfer.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        <h3>
          <Download size={16} /> {t('transfer.receivedTitle')}
        </h3>
        {incoming === null ? (
          <p className="hint">
            <Loader2 size={14} className="spin" /> {t('transfer.searching')}
          </p>
        ) : incoming.length === 0 ? (
          <p className="hint">{t('transfer.noneReceived')}</p>
        ) : (
          incoming.map((tr) => (
            <div key={tr.manifestId} className="row" style={{ marginBlockEnd: 8 }}>
              <span>
                <bdi>{tr.manifest.path.join(' / ')}</bdi> — {t('transfer.fromWho', { email: tr.manifest.from, count: Object.keys(tr.manifest.items).length })}
              </span>
              <button
                className="btn primary"
                disabled={!!busy}
                onClick={() =>
                  run(
                    () => acceptTransfer(tr, (done, total) => setBusy({ done, total })),
                    'transfer.accepted',
                  ).then(() => setIncoming((list) => list?.filter((x) => x !== tr) ?? null))
                }
              >
                {t('transfer.accept')}
              </button>
            </div>
          ))
        )}

        <h3>
          <Send size={16} /> {t('transfer.sendTitle')}
        </h3>
        <p className="hint">{t('transfer.sendHint')}</p>
        <label className="field">
          {t('transfer.what')}
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={!!busy}>
            <option value="">{t('transfer.choose')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({fmt.number(f.count)})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('transfer.to')}
          <input type="email" dir="ltr" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!busy} />
        </label>
        <label className="field">
          {t('transfer.message')}
          <input type="text" dir="auto" value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!busy} />
        </label>
        {chosen && validEmail && <p>{t('transfer.confirm', { name: chosen.label.trim(), count: chosen.count, email: email.trim() })}</p>}
        <button
          className="btn primary"
          disabled={!!busy || !chosen || !validEmail}
          onClick={() => run(() => sendFolder(folderId, email, message, (done, total) => setBusy({ done, total })), 'transfer.sent')}
        >
          <Send size={16} /> {t('transfer.send')}
        </button>

        {busy && (
          <p>
            <Loader2 size={14} className="spin" /> {busy.total ? t('select.working', { done: fmt.number(busy.done), total: fmt.number(busy.total) }) : t('transfer.preparing')}
          </p>
        )}
        {result && <p className="ok-text">{result}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  )
}
