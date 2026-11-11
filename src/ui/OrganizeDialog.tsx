import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { putIntoCategories } from '../sync/folders'
import { CategoryProposal, useCategoryProposal, type ProposalAlbum } from './CategoryProposal'
import { Modal } from './Dialog'
import type { Library } from './useLibrary'

/** The categories without albums (folders of photos put in the root), as albums to sort. */
export function loneFolders(lib: Library) {
  return lib.categories.filter((c) => c.children.length === 0 && c.count > 0)
}

/** "Sort into categories": the folders of the root that hold only photos, put into categories proposed from their names. */
export function OrganizeDialog({ lib, onClose }: { lib: Library; onClose: () => void }) {
  const { t } = useTranslation()
  const lone = useMemo(() => loneFolders(lib), [lib])
  const albums = useMemo<ProposalAlbum[]>(() => lone.map((f) => ({ name: f.name, count: f.count })).sort((a, b) => a.name.localeCompare(b.name)), [lone])
  const proposal = useCategoryProposal(albums)
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null)
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null)

  const moves = lone.flatMap((f) => {
    const category = proposal.categoryOf(f.name)
    // An album already named like its category stays: it is that category.
    return category && category.trim().toLocaleLowerCase() !== f.name.trim().toLocaleLowerCase() ? [{ id: f.id, category }] : []
  })

  async function run() {
    setProgress({ done: 0, failed: 0, total: moves.length })
    setResult(await putIntoCategories(moves, (done, failed) => setProgress({ done, failed, total: moves.length })))
  }

  const busy = progress !== null && result === null
  return (
    <Modal wide title={t('autoCategories.organizeTitle')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        {!progress && (
          <>
            <p>{t('autoCategories.organizeIntro', { count: lone.length })}</p>
            <CategoryProposal state={proposal} />
          </>
        )}
        {progress && (
          <div className="import-progress" aria-live="polite">
            <strong>
              {busy && <Loader2 size={14} className="spin" />} {t('autoCategories.moving', { done: progress.done + progress.failed, total: progress.total })}
            </strong>
            <progress max={progress.total || 1} value={progress.done + progress.failed} />
          </div>
        )}
        {result && (
          <>
            <p className="ok-text">{t('autoCategories.moved', { count: result.moved })}</p>
            {result.failed > 0 && <p className="error-text">{t('autoCategories.failed', { count: result.failed })}</p>}
          </>
        )}
      </div>
      <div className="actions">
        {!progress && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!moves.length} onClick={() => void run()}>
              {t('autoCategories.organizeButton', { count: moves.length })}
            </button>
          </>
        )}
        {result && (
          <button className="btn primary" onClick={onClose}>
            {t('common.close')}
          </button>
        )}
      </div>
    </Modal>
  )
}
