// Sharing a folder by a link: the whole library (its root) or one album. Anyone who has the link sees
// that folder and everything in it, without signing in (ui/PublicLibrary), and nothing above it.

import { Copy, Link2, Loader2, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { useFormat } from '../i18n/format'
import { linkPermission, listPermissions, removePermission, shareWithLink, type Permission } from '../drive/api'
import { MAX_LINK_FOLDERS, publicLink } from '../lib/publicLink'
import { useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'
import { FolderChecklist } from './FolderChecklist'
import { useLibraryContext } from './libraryContext'

/** The link of one folder: create it, copy it, send it, stop it. `album`: the folder is an album (not the whole library). */
export function LinkShare({ folderId, album }: { folderId: string; album?: string }) {
  const { t } = useTranslation()
  const user = useApp((s) => s.user)
  const [perm, setPerm] = useState<Permission | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const link = publicLink(folderId)

  const load = useCallback(async () => {
    try {
      setPerm((await listPermissions(folderId)).find((p) => p.type === 'anyone') ?? null)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
  }, [folderId, t])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      await shareWithLink(folderId)
      await load()
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    } finally {
      setBusy(false)
    }
  }

  // An album's link joins the links sent (the whole library's link is shown above them).
  const remember = () => album && void rememberSent([folderId], [album])

  async function copy() {
    remember()
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused: the link stays shown, to copy by hand.
    }
  }

  const owner = user?.name || user?.email || ''
  return (
    <>
      {perm === undefined && !error ? (
        <Loader2 size={16} className="spin" />
      ) : perm ? (
        <>
          <input className="share-link" type="text" dir="ltr" readOnly value={link} onFocus={(e) => e.target.select()} />
          <div className="actions">
            <button className="btn primary" onClick={() => void copy()}>
              <Copy size={16} /> {copied ? t('share.linkCopied') : t('share.linkCopy')}
            </button>
            <a
              className="btn"
              href={`https://wa.me/?text=${encodeURIComponent(
                album ? t('share.albumWhatsappText', { owner, album, link }) : t('share.linkWhatsappText', { owner, link }),
              )}`}
              onClick={remember}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={16} /> {t('share.whatsapp')}
            </a>
            <button className="btn" onClick={() => setStopping(true)}>
              {t('share.linkStop')}
            </button>
          </div>
          <p className="hint">{t(album ? 'share.albumWarning' : 'share.linkWarning')}</p>
        </>
      ) : (
        perm === null && (
          <div className="actions">
            <button className="btn primary" onClick={() => void create()} disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <Link2 size={16} />} {t('share.linkCreate')}
            </button>
          </div>
        )
      )}
      {error && <p className="error-text">{error}</p>}
      {stopping && perm && (
        <ConfirmDialog
          title={t('share.linkStopTitle')}
          text={t('share.linkStopText')}
          confirmLabel={t('share.linkStop')}
          danger
          onConfirm={async () => {
            const stillShown = await stopLinks([folderId])
            await load()
            if (stillShown) throw new Error(t('share.inheritedStop'))
          }}
          onClose={() => setStopping(false)}
        />
      )}
    </>
  )
}

/** From an album's title bar: that album alone, shared by a link. */
export function AlbumLinkDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal title={t('share.albumTitle', { name })} onClose={onClose}>
      <p className="hint">{t('share.albumIntro')}</p>
      <LinkShare folderId={id} album={name} />
      <div className="actions">
        <button className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  )
}

/**
 * "By a link": the whole library ticked by default, or one or more of its albums. The link is made (Drive's
 * "anyone with the link") when it is copied or sent, and joins the links sent below.
 */
export function LinkPicker() {
  const { t } = useTranslation()
  const lib = useLibraryContext()
  const user = useApp((s) => s.user)
  const rootId = useApp((s) => s.rootId)
  const rootName = useApp((s) => s.settings.rootName)
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rootId ? [rootId] : []))
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!lib || !rootId) return null
  // A ticked folder takes what it holds: only the top ones go in the link.
  const top = checked.has(rootId)
    ? [rootId]
    : [...checked].filter((id) => {
        for (let p = lib.folders.get(id)?.parentId; p; p = lib.folders.get(p)?.parentId) if (checked.has(p)) return false
        return true
      })
  const nameOf = (id: string) => (id === rootId ? rootName : (lib.folders.get(id)?.name ?? ''))
  const names = top.map(nameOf)
  const link = top.length ? publicLink(top) : ''
  const tooMany = top.length > MAX_LINK_FOLDERS
  const parents = [...lib.folders.values()].filter((f) => [...lib.folders.values()].some((c) => c.parentId === f.id)).map((f) => f.id)

  /** Shares the ticked folders by a link (those not shared yet), and keeps the link in the list below. */
  async function make(): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      for (const id of top) if (!(await linkPermission(id))) await shareWithLink(id)
      await rememberSent(top, names)
      return true
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!(await make())) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard refused: the link stays in the list below, to copy from there.
    }
  }

  async function whatsapp() {
    // Opened at once (still the click), filled once the link works.
    const w = window.open('', '_blank')
    if (!(await make())) return w?.close()
    const text = top[0] === rootId ? t('share.linkWhatsappText', { owner: user?.name || user?.email || '', link }) : t('share.albumWhatsappText', { owner: user?.name || user?.email || '', album: names.join(', '), link })
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    if (w) w.location.href = url
    else location.href = url
  }

  return (
    <>
      <p className="hint">{t('share.linkIntro')}</p>
      <div className="row">
        <span className="hint" style={{ flex: 1 }}>
          {checked.has(rootId) && t('share.pickHint', { name: rootName })}
        </span>
        <button className="btn" onClick={() => setExpanded((x) => !x)}>
          {expanded ? t('share.collapseAll') : t('share.expandAll')}
        </button>
      </div>
      <div className="folder-checklist-scroll">
        <FolderChecklist
          key={String(expanded)}
          categories={lib.categories}
          checked={checked}
          onChange={setChecked}
          disabled={busy}
          root={{ id: rootId, label: rootName }}
          initialOpen={expanded ? parents : []}
        />
      </div>
      <div className="actions">
        <button className="btn primary" onClick={() => void copy()} disabled={busy || !top.length || tooMany}>
          {busy ? <Loader2 size={16} className="spin" /> : <Copy size={16} />} {copied ? t('share.linkCopied') : t('share.linkCopy')}
        </button>
        <button className="btn" onClick={() => void whatsapp()} disabled={busy || !top.length || tooMany}>
          <MessageCircle size={16} /> {t('share.whatsapp')}
        </button>
      </div>
      {!top.length && <p className="hint">{t('share.pickNone')}</p>}
      {tooMany && <p className="error-text">{t('share.chosenTooMany', { max: MAX_LINK_FOLDERS })}</p>}
      {error && <p className="error-text">{error}</p>}
      <p className="hint">{t('share.linkWarning')}</p>
    </>
  )
}

/**
 * Stops the links of these folders. A folder shown only through a link set higher up (the whole library)
 * cannot be stopped alone: true when one of them stays visible that way.
 */
async function stopLinks(ids: string[]): Promise<boolean> {
  let inherited = false
  for (const id of ids) {
    const perm = await linkPermission(id)
    if (!perm) continue
    if (perm.inherited) {
      inherited = true
      continue
    }
    try {
      await removePermission(id, perm.id)
    } catch (e) {
      // Google's answer for a permission set on a folder above.
      if (!/inherited/i.test((e as Error).message)) throw e
      inherited = true
    }
  }
  return inherited
}

// ---- The links sent (copied or sent by WhatsApp), to find them again ----------------------------

export interface SentLink {
  ids: string[]
  names: string[]
  at: string
}

const SENT_KEY = 'sentLinks'
const sentListeners = new Set<() => void>()

async function sentLinks(): Promise<SentLink[]> {
  return (await db().getKv<SentLink[]>(SENT_KEY)) ?? []
}

async function saveSent(list: SentLink[]) {
  await db().setKv(SENT_KEY, list)
  for (const fn of sentListeners) fn()
}

/** Kept when the link is copied or sent: the same albums again replace the older line. */
export async function rememberSent(ids: string[], names: string[]): Promise<void> {
  const key = [...ids].sort().join(',')
  const others = (await sentLinks()).filter((l) => [...l.ids].sort().join(',') !== key)
  await saveSent([{ ids, names, at: new Date().toISOString() }, ...others])
}

/** The album links sent from this library, each to copy, send again or stop. */
export function SentLinks() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const user = useApp((s) => s.user)
  const rootId = useApp((s) => s.rootId)
  const [list, setList] = useState<SentLink[]>([])
  const [copied, setCopied] = useState<string | null>(null)
  const [stopping, setStopping] = useState<SentLink | null>(null)

  const load = useCallback(async () => {
    const all = await sentLinks()
    // A link whose albums were all stopped (from an album's 🔗) is gone.
    const alive = await Promise.all(
      all.map(async (l) => {
        const shared = await Promise.all(l.ids.map((id) => listPermissions(id).then((p) => p.some((x) => x.type === 'anyone'), () => false)))
        return shared.some(Boolean)
      }),
    )
    const kept = all.filter((_, i) => alive[i])
    if (kept.length !== all.length) await db().setKv(SENT_KEY, kept)
    setList(kept)
  }, [])

  useEffect(() => {
    const reload = () => void load().catch((e) => console.warn('[MyMedia] links sent', e))
    reload()
    sentListeners.add(reload)
    return () => void sentListeners.delete(reload)
  }, [load])

  if (!list.length) return null
  const owner = user?.name || user?.email || ''
  return (
    <>
      <h3>{t('share.sentTitle')}</h3>
      {list.map((l) => {
        const link = publicLink(l.ids)
        const key = l.ids.join(',')
        return (
          <div key={key} className="sent-link">
            <div>
              <Link2 size={14} /> <bdi>{l.names.join(', ')}</bdi> <span className="hint">· {fmt.date(l.at)}</span>
            </div>
            <div className="actions">
              <button
                className="btn"
                onClick={() =>
                  void navigator.clipboard.writeText(link).then(() => {
                    setCopied(key)
                    setTimeout(() => setCopied(null), 2000)
                  }, () => undefined)
                }
              >
                <Copy size={16} /> {copied === key ? t('share.linkCopied') : t('share.linkCopy')}
              </button>
              <a
                className="btn"
                href={`https://wa.me/?text=${encodeURIComponent(
                  l.ids[0] === rootId ? t('share.linkWhatsappText', { owner, link }) : t('share.albumWhatsappText', { owner, album: l.names.join(', '), link }),
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle size={16} /> {t('share.whatsapp')}
              </a>
              <button className="btn" onClick={() => setStopping(l)}>
                {t('share.linkStop')}
              </button>
            </div>
          </div>
        )
      })}
      {stopping && (
        <ConfirmDialog
          title={t('share.linkStopTitle')}
          text={t('share.sentStopText', { names: stopping.names.join(', ') })}
          confirmLabel={t('share.linkStop')}
          danger
          onConfirm={async () => {
            const stillShown = await stopLinks(stopping.ids)
            await saveSent((await sentLinks()).filter((l) => l.ids.join(',') !== stopping.ids.join(',')))
            if (stillShown) throw new Error(t('share.inheritedStop'))
          }}
          onClose={() => setStopping(null)}
        />
      )}
    </>
  )
}
