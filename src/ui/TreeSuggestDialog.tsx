import { ClipboardList, FolderOpen, FolderTree, Library as LibraryIcon, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaFiles } from '../import/importer'
import { foldersOfFiles, foldersOfText } from '../lib/folderNames'
import { putIntoCategories } from '../sync/folders'
import { CategoryProposal, useCategoryProposal, type CategoryChoice, type ProposalAlbum } from './CategoryProposal'
import { Modal } from './Dialog'
import type { Library } from './useLibrary'

type Source = 'computer' | 'paste' | 'library'
const NONE: ProposalAlbum[] = []

/** The categories without albums (folders of photos put in the root), as albums to sort. */
export function loneFolders(lib: Library) {
  return lib.categories.filter((c) => c.children.length === 0 && c.count > 0)
}

interface Props {
  lib: Library
  /** The chosen folder imported into MyMedia with the categories checked here. */
  onImport: (files: File[], categories: CategoryChoice) => void
  onClose: () => void
}

/**
 * "Tree suggestion": MyMedia reads only the names of the folders and sub-folders (of a folder of the
 * computer, of a pasted list, or of MyMedia's albums without a category) and proposes categories.
 */
export function TreeSuggestDialog({ lib, onImport, onClose }: Props) {
  const { t } = useTranslation()
  const canPickFolder = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent)
  const lone = useMemo(() => loneFolders(lib), [lib])
  const [source, setSource] = useState<Source | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [folderName, setFolderName] = useState('')
  const [text, setText] = useState('')
  const [pasted, setPasted] = useState<ProposalAlbum[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null)
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null)
  const folderInput = useRef<HTMLInputElement>(null)

  const fromComputer = useMemo(() => foldersOfFiles(files.map((f) => f.webkitRelativePath || f.name)), [files])
  const fromLibrary = useMemo(() => lone.map((f) => ({ name: f.name, count: f.count })).sort((a, b) => a.name.localeCompare(b.name)), [lone])
  const albums = source === 'computer' ? fromComputer : source === 'paste' ? (pasted ?? NONE) : source === 'library' ? fromLibrary : NONE
  const proposal = useCategoryProposal(albums)

  const moves = lone.flatMap((f) => {
    const category = proposal.categoryOf(f.name)
    // An album already named like its category stays: it is that category.
    return category && category.trim().toLocaleLowerCase() !== f.name.trim().toLocaleLowerCase() ? [{ id: f.id, category }] : []
  })

  function pickFolder(list: FileList | null) {
    const all = [...(list ?? [])]
    const media = mediaFiles(all)
    setFolderName(all[0]?.webkitRelativePath.split('/')[0] ?? '')
    setFiles(media)
    setSource('computer')
  }

  async function sortLibrary() {
    setProgress({ done: 0, failed: 0, total: moves.length })
    setResult(await putIntoCategories(moves, (done, failed) => setProgress({ done, failed, total: moves.length })))
  }

  const busy = progress !== null && result === null
  return (
    <Modal wide title={t('treeSuggest.title')} onClose={() => !busy && onClose()}>
      <div className="modal-scroll">
        {!progress && (
          <>
            <div className="tree-suggest-intro">
              <FolderTree size={28} />
              <div>
                <p>
                  <span className="tag auto">{t('treeSuggest.new')}</span> <strong>{t('treeSuggest.lead')}</strong>
                </p>
                <p className="hint">{t('treeSuggest.privacy')}</p>
              </div>
            </div>

            <div className="tree-suggest-sources">
              {canPickFolder && (
                <button className={`btn ${source === 'computer' ? 'primary' : ''}`} onClick={() => folderInput.current?.click()}>
                  <FolderOpen size={18} /> {t('treeSuggest.fromComputer')}
                </button>
              )}
              <button className={`btn ${source === 'paste' ? 'primary' : ''}`} onClick={() => setSource('paste')}>
                <ClipboardList size={18} /> {t('treeSuggest.fromPaste')}
              </button>
              {lone.length >= 2 && (
                <button className={`btn ${source === 'library' ? 'primary' : ''}`} onClick={() => setSource('library')}>
                  <LibraryIcon size={18} /> {t('treeSuggest.fromLibrary', { count: lone.length })}
                </button>
              )}
            </div>
            <input
              ref={folderInput}
              type="file"
              hidden
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                pickFolder(e.target.files)
                e.target.value = ''
              }}
            />
            {canPickFolder && !source && <p className="hint">{t('treeSuggest.computerHint')}</p>}

            {source === 'paste' && (
              <div className="field">
                <span>{t('treeSuggest.pasteLabel')}</span>
                <textarea rows={6} dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder={'├── anniv papa\n├── EinGuedi2015\n│   └── 873NIKON\n└── mariageAvishai'} spellCheck={false} />
                <span className="hint">{t('treeSuggest.pasteHint')}</span>
                <div>
                  <button className="btn" disabled={!text.trim()} onClick={() => setPasted(foldersOfText(text))}>
                    {t('treeSuggest.read')}
                  </button>
                </div>
              </div>
            )}

            {source === 'computer' && (
              <p>
                <strong>
                  <bdi>{folderName}</bdi>
                </strong>{' '}
                — {t('treeSuggest.found', { count: fromComputer.length, files: files.length })}
              </p>
            )}
            {source === 'library' && <p>{t('treeSuggest.libraryIntro', { count: lone.length })}</p>}
            {source && albums.length > 0 && <CategoryProposal state={proposal} />}
            {source && albums.length === 0 && (source !== 'paste' || pasted !== null) && <p className="hint">{t('autoCategories.noFolders')}</p>}
            {source === 'paste' && albums.length > 0 && <p className="hint">{t('treeSuggest.pastePreview')}</p>}
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
              {t('common.close')}
            </button>
            {source === 'computer' && (
              <button className="btn primary" disabled={!files.length || !fromComputer.length} onClick={() => onImport(files, proposal.choice)}>
                {t('treeSuggest.import', { count: files.length })}
              </button>
            )}
            {source === 'library' && (
              <button className="btn primary" disabled={!moves.length} onClick={() => void sortLibrary()}>
                {t('autoCategories.organizeButton', { count: moves.length })}
              </button>
            )}
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
