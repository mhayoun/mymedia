import { useTranslation } from 'react-i18next'
import { useApp } from '../store'
import { Modal } from './Dialog'
import { SharedLibraries } from './SharedLibraries'

/** Which MyMedia is open (mine or one shared with me), and the others to open. */
export function LibraryInfo() {
  const { t } = useTranslation()
  const shared = useApp((s) => s.shared)
  const readOnly = useApp((s) => s.readOnly)
  const rootName = useApp((s) => s.settings.rootName)
  const owner = shared?.ownerName ?? shared?.ownerEmail ?? ''
  return (
    <>
      <p>
        <strong>
          <bdi>{shared ? t(readOnly ? 'library.readOnlyOf' : 'library.sharedOf', { owner }) : t('library.mine')}</bdi>
        </strong>
      </p>
      {shared && <p className="hint">{t(readOnly ? 'library.readOnlyHint' : 'library.sharedHint', { owner })}</p>}
      <SharedLibraries />
      {!shared && <p className="hint">{t('library.shareHint', { name: rootName })}</p>}
    </>
  )
}

/** The eye button's window. */
export function LibraryDialog() {
  const { t } = useTranslation()
  const set = useApp((s) => s.set)
  return (
    <Modal closeButton title={t('library.title')} onClose={() => set({ libraryOpen: false })}>
      <div className="modal-scroll">
        <LibraryInfo />
      </div>
    </Modal>
  )
}
