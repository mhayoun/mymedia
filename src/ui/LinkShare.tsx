// Sharing a folder by a link: the whole library (its root) or one album. Anyone who has the link sees
// that folder and everything in it, without signing in (ui/PublicLibrary), and nothing above it.

import { Copy, Link2, Loader2, MessageCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { db } from '../db/db'
import { listFiles, listPermissions, removePermission, shareWithLink, type Permission } from '../drive/api'
import { FOLDER_MIME } from '../lib/media'
import { publicLink } from '../lib/publicLink'
import { useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'

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

  async function copy() {
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
            await removePermission(folderId, perm.id)
            await load()
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

/** The albums of this library shared by a link, each opened in its own window (to copy or stop its link). */
export function SharedAlbumLinks() {
  const { t } = useTranslation()
  const rootId = useApp((s) => s.rootId)
  const [albums, setAlbums] = useState<{ id: string; name: string }[]>([])
  const [open, setOpen] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    const mine = new Set((await db().folders.toCollection().primaryKeys()) as string[])
    const found: { id: string; name: string }[] = []
    await listFiles(
      `mimeType = '${FOLDER_MIME}' and visibility = 'anyoneWithLink' and 'me' in owners and trashed = false`,
      (files) => void found.push(...files.filter((f) => f.id !== rootId && mine.has(f.id)).map((f) => ({ id: f.id, name: f.name }))),
      undefined,
      'id,name',
    )
    setAlbums(found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })))
  }, [rootId])

  useEffect(() => {
    load().catch((e) => console.warn('[MyMedia] albums shared by link', e))
  }, [load])

  if (!albums.length) return null
  return (
    <>
      <h3>{t('share.albumsTitle')}</h3>
      {albums.map((a) => (
        <div key={a.id} className="check-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <Link2 size={14} /> <bdi>{a.name}</bdi>
          </span>
          <button className="btn" onClick={() => setOpen(a)}>
            {t('share.albumManage')}
          </button>
        </div>
      ))}
      {open && (
        <AlbumLinkDialog
          id={open.id}
          name={open.name}
          onClose={() => {
            setOpen(null)
            void load()
          }}
        />
      )}
    </>
  )
}
