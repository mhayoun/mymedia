import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteAllFaceData } from '../faces/store'
import { useApp } from '../store'
import { ConfirmDialog, Modal } from './Dialog'
import type { People } from './usePeople'

const SEEN_KEY = 'mymedia.facesNoticeSeen'

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** First launch: face recognition is on — what it does, how to turn it off or delete everything. */
export function FacesIntro({ people }: { people: People }) {
  const { t } = useTranslation()
  const enabled = useApp((s) => s.settings.facesEnabled)
  const updateSettings = useApp((s) => s.updateSettings)
  const [open, setOpen] = useState(() => !seen())
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!open) return null

  const close = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // shown again next time
    }
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
