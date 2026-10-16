import { Download, Loader2, Send, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { useApp } from '../store'
import { acceptTransfer, findIncoming, sendFolder, sendPeople, TransferError, type IncomingTransfer, type TransferResult } from '../transfer/transfer'
import { Modal } from './Dialog'
import { FolderChecklist } from './FolderChecklist'
import { useLibraryContext } from './libraryContext'
import type { FolderInfo } from './useLibrary'

type Busy = { done: number; total: number } | null

/** Settings → give a category or album to another Google account, or accept one. */
export function TransferDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const lib = useLibraryContext()
  const rootId = useApp((s) => s.rootId)
  const [checked, setChecked] = useState<Set<string>>(new Set())
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

  // What is sent: the ticked folders not inside another ticked one (it takes them along).
  const chosen = useMemo(() => {
    const out: { id: string; name: string; count: number }[] = []
    if (rootId && checked.has(rootId)) return [{ id: rootId, name: t('transfer.everything'), count: lib?.items.length ?? 0 }]
    const walk = (list: FolderInfo[]) => {
      for (const f of list) {
        if (checked.has(f.id)) out.push({ id: f.id, name: f.name, count: f.count })
        else walk(f.children)
      }
    }
    walk(lib?.categories ?? [])
    return out
  }, [checked, lib, rootId, t])
  const everything = chosen[0]?.id === rootId
  const chosenCount = chosen.reduce((n, f) => n + f.count, 0)
  const [current, setCurrent] = useState<{ n: number; total: number; name: string } | null>(null)
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  /** Several transfers one after the other, their results added up. */
  const runAll = async <T,>(list: T[], name: (x: T) => string, fn: (x: T) => Promise<TransferResult>): Promise<TransferResult> => {
    const sum: TransferResult = { total: 0, failed: 0, skipped: 0, otherOwners: [] }
    for (const [k, x] of list.entries()) {
      setCurrent(list.length > 1 ? { n: k + 1, total: list.length, name: name(x) } : null)
      setBusy({ done: 0, total: 0 })
      const r = await fn(x)
      sum.total += r.total
      sum.failed += r.failed
      sum.reason ??= r.reason
      sum.skipped += r.skipped
      sum.otherOwners = [...new Set([...sum.otherOwners, ...r.otherOwners])]
    }
    setCurrent(null)
    return sum
  }

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
      setCurrent(null)
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
          <>
            {incoming.length > 1 && (
              <button
                className="btn primary"
                style={{ marginBlockEnd: 8 }}
                disabled={!!busy}
                onClick={() => {
                  const list = incoming
                  void run(
                    () => runAll(list, (tr) => (tr.manifest.path.length ? tr.manifest.path.join(' / ') : t('transfer.everything')), (tr) => acceptTransfer(tr, (done, total) => setBusy({ done, total }))),
                    'transfer.accepted',
                  ).then(() => setIncoming((l) => l?.filter((x) => !list.includes(x)) ?? null))
                }}
              >
                {t('transfer.acceptAll', { count: incoming.length })}
              </button>
            )}
            {incoming.map((tr) => (
              <div key={tr.manifestId} className="row" style={{ marginBlockEnd: 8 }}>
                <span>
                  {tr.manifest.kind === 'people' ? (
                    t('transfer.peopleFrom', { email: tr.manifest.from })
                  ) : (
                    <>
                      <bdi>{tr.manifest.path.length ? tr.manifest.path.join(' / ') : t('transfer.everything')}</bdi> — {t('transfer.fromWho', { email: tr.manifest.from, count: Object.keys(tr.manifest.items).length })}
                    </>
                  )}
                </span>
                <button
                  className="btn primary"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      () => acceptTransfer(tr, (done, total) => setBusy({ done, total })),
                      tr.manifest.kind === 'people' ? 'transfer.peopleAccepted' : 'transfer.accepted',
                    ).then(() => setIncoming((list) => list?.filter((x) => x !== tr) ?? null))
                  }
                >
                  {t('transfer.accept')}
                </button>
              </div>
            ))}
          </>
        )}

        <h3>
          <Send size={16} /> {t('transfer.sendTitle')}
        </h3>
        <p className="hint" style={{ whiteSpace: 'pre-line' }}>{t('transfer.sendHint')}</p>
        <div className="field">
          {t('transfer.what')}
          <span className="hint">{t('transfer.choose')}</span>
          <FolderChecklist
            categories={lib?.categories ?? []}
            checked={checked}
            onChange={setChecked}
            disabled={!!busy}
            root={rootId ? { id: rootId, label: `${t('transfer.everything')} (${fmt.number(lib?.items.length ?? 0)})` } : undefined}
            extra={(f) => <span className="hint">({fmt.number(f.count)})</span>}
          />
        </div>
        <label className="field">
          {t('transfer.to')}
          <input type="email" dir="ltr" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!busy} />
        </label>
        <label className="field">
          {t('transfer.message')}
          <input type="text" dir="auto" value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!busy} />
        </label>
        {chosen.length > 0 && validEmail && (
          <p>
            {chosen.length === 1
              ? t('transfer.confirm', { name: chosen[0].name, count: chosen[0].count, email: email.trim() })
              : t('transfer.confirmMany', { folders: chosen.length, count: chosenCount, email: email.trim() })}
          </p>
        )}
        {everything && <p className="hint">{t('transfer.everythingHint')}</p>}
        <button
          className="btn primary"
          disabled={!!busy || !chosen.length || !validEmail}
          onClick={() =>
            run(() => runAll(chosen, (f) => f.name, (f) => sendFolder(f.id, email, message, (done, total) => setBusy({ done, total }))), 'transfer.sent').then(() =>
              setChecked(new Set()),
            )
          }
        >
          <Send size={16} /> {t('transfer.send')}
        </button>

        <h3>
          <Users size={16} /> {t('transfer.peopleTitle')}
        </h3>
        <p className="hint">{t('transfer.peopleHint')}</p>
        <button
          className="btn"
          disabled={!!busy || !validEmail}
          onClick={() =>
            run(async () => {
              const n = await sendPeople(email)
              return { total: n, failed: 0, skipped: 0, otherOwners: [] }
            }, 'transfer.peopleSent')
          }
        >
          <Users size={16} /> {t('transfer.sendPeople')}
        </button>

        {busy && (
          <p>
            <Loader2 size={14} className="spin" />{' '}
            {current && (
              <>
                <bdi>{current.name}</bdi> ({fmt.number(current.n)} / {fmt.number(current.total)}) ·{' '}
              </>
            )}
            {busy.total ? t('select.working', { done: fmt.number(busy.done), total: fmt.number(busy.total) }) : t('transfer.preparing')}
          </p>
        )}
        {result && <p className="ok-text">{result}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    </Modal>
  )
}
