import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getFile, setAppProperties } from '../drive/api'
import { deleteAllFaceData } from '../faces/store'
import { useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'
import type { People } from './usePeople'

/** Before it was kept per account: seen in this browser. */
const OLD_KEY = 'mymedia.facesNoticeSeen'
/** On the MyMedia folder in Drive, so the notice is shown once per Google account. */
const DRIVE_PROP = 'mymedia_faces_notice'
const localKey = (rootId: string) => `${OLD_KEY}.${rootId}`

function readLocal(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeLocal(key: string) {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Drive still has it
  }
}

/** First time for a Google account: face recognition is on — what it does, how to turn it off or delete everything. */
export function FacesIntro({ people }: { people: People }) {
  const { t } = useTranslation()
  const enabled = useApp((s) => s.settings.facesEnabled)
  const updateSettings = useApp((s) => s.updateSettings)
  const rootId = useApp((s) => s.rootId)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!rootId || readLocal(localKey(rootId))) return
    let live = true
    getFile(rootId, 'id,appProperties')
      .then((f) => {
        if (!live) return
        if (f.appProperties?.[DRIVE_PROP]) return writeLocal(localKey(rootId))
        if (readLocal(OLD_KEY)) {
          // Seen in this browser before it was kept per account.
          writeLocal(localKey(rootId))
          return setAppProperties(rootId, { [DRIVE_PROP]: '1' })
        }
        setOpen(true)
      })
      .catch((e) => console.error('[MyMedia] faces notice', e))
    return () => {
      live = false
    }
  }, [rootId])

  if (!open || !rootId) return null

  const close = () => {
    writeLocal(localKey(rootId))
    setAppProperties(rootId, { [DRIVE_PROP]: '1' }).catch((e) => console.error('[MyMedia] faces notice not saved', e))
    setOpen(false)
  }
  const hasData = people.named.length + people.unnamed.length + people.single.length > 0

  return (
    <>
      <Modal title={t('faces.introTitle')} onClose={close}>
        <p>{t('faces.introText')}</p>
        <p className="hint">{t('faces.introPrivacy')}</p>
        <label className="radio-row">
          <input type="checkbox" checked={enabled} onChange={(e) => updateSettings({ facesEnabled: e.target.checked })} />
          {t('faces.enable')}
        </label>
        {hasData && (
          <button className="btn ghost" onClick={() => setConfirmDelete(true)}>
            {t('faces.deleteAll')}
          </button>
        )}
        <div className="actions">
          <button className="btn primary" onClick={close}>
            {t('common.ok')}
          </button>
        </div>
      </Modal>
      {confirmDelete && (
        <ConfirmDialog
          title={t('faces.deleteAllTitle')}
          text={t('faces.deleteAllText')}
          confirmLabel={t('common.delete')}
          danger
          onConfirm={deleteAllFaceData}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
