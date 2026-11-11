import { Download, FolderOpen, FolderTree, Library as LibraryIcon, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { canWalkFolders, filesOf, pickAndWalk, type WalkedFolder } from '../import/folderWalk'
import { mediaFiles } from '../import/importer'
import { useFormat } from '../i18n/format'
import { foldersOfFiles, treeText } from '../lib/folderNames'
import { createCategories, putIntoCategories } from '../sync/folders'
import { CategoryProposal, useCategoryProposal, type CategoryChoice, type ProposalAlbum } from './CategoryProposal'
import { Modal } from './Dialog'
import type { Library } from './useLibrary'

type Source = 'computer' | 'library'
const NONE: ProposalAlbum[] = []

/** The categories without albums (folders of photos put in the root), as albums to sort. */
export function loneFolders(lib: Library) {
  return lib.categories.filter((c) => c.children.length === 0 && c.count > 0)
}

/** A folder MyMedia read: its name, every folder below it, its photos and videos (paths), and how to get them. */
interface ReadFolder {
  name: string
  dirs: string[][]
  paths: string[]
  /** Walked by MyMedia (Chrome / Edge): the files are read only at import. */
  walked?: WalkedFolder
  /** Chosen with the browser's folder window (other browsers): the files themselves. */
  files?: File[]
}

/** Folders of the files' paths (a folder without photos is not seen this way). */
function dirsOfPaths(paths: string[]): string[][] {
  const seen = new Map<string, string[]>()
  for (const p of paths) {
    const parts = p.split('/').slice(1, -1)
    for (let d = 1; d <= parts.length; d++) seen.set(parts.slice(0, d).join('/'), parts.slice(0, d))
  }
  return [...seen.values()]
}

interface Props {
  lib: Library
  /** The chosen folder imported into MyMedia with the categories checked here. */
  onImport: (files: File[], categories: CategoryChoice) => void
  onClose: () => void
}

/**
 * "Tree suggestion": MyMedia reads only the names of the folders and sub-folders (of a folder of the
 * computer, or of MyMedia's albums without a category) and proposes categories.
 */
export function TreeSuggestDialog({ lib, onImport, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const walks = canWalkFolders()
  const canPickFolder = walks || (typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent))
  const lone = useMemo(() => loneFolders(lib), [lib])
  const [source, setSource] = useState<Source | null>(null)
  const [folder, setFolder] = useState<ReadFolder | null>(null)
  const [reading, setReading] = useState<{ dirs: number; files: number } | null>(null)
  // Before the browser's own window ("view and copy files", "upload files"): what MyMedia really does.
  const [explain, setExplain] = useState(false)
  const [preparing, setPreparing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; failed: number; total: number } | null>(null)
  const [result, setResult] = useState<{ moved: number; failed: number } | null>(null)
  const [created, setCreated] = useState<{ count: number; existing: number } | null>(null)
  const [creating, setCreating] = useState(false)
  const folderInput = useRef<HTMLInputElement>(null)

  const fromComputer = useMemo(() => (folder ? foldersOfFiles(folder.paths) : NONE), [folder])
  const fromLibrary = useMemo(() => lone.map((f) => ({ name: f.name, count: f.count })).sort((a, b) => a.name.localeCompare(b.name)), [lone])
  const albums = source === 'computer' ? fromComputer : source === 'library' ? fromLibrary : NONE
  const proposal = useCategoryProposal(albums)
  const tree = useMemo(() => (folder ? treeText(folder.name, folder.dirs) : ''), [folder])

  const moves = lone.flatMap((f) => {
    const category = proposal.categoryOf(f.name)
    // An album already named like its category stays: it is that category.
    return category && category.trim().toLocaleLowerCase() !== f.name.trim().toLocaleLowerCase() ? [{ id: f.id, category }] : []
  })

  async function readFolder() {
    setExplain(false)
    if (!walks) return folderInput.current?.click()
    setError(null)
    setReading({ dirs: 0, files: 0 })
    try {
      const w = await pickAndWalk((dirs, files) => setReading({ dirs, files }))
      if (w) {
        setFolder({ name: w.name, dirs: w.dirs, paths: w.files.map((f) => f.path), walked: w })
        setSource('computer')
      }
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    setReading(null)
  }

  function pickedFiles(list: FileList | null) {
    const all = [...(list ?? [])]
    if (!all.length) return
    const files = mediaFiles(all)
    setFolder({
      name: all[0].webkitRelativePath.split('/')[0] ?? '',
      dirs: dirsOfPaths(all.map((f) => f.webkitRelativePath)),
      paths: files.map((f) => f.webkitRelativePath),
      files,
    })
    setSource('computer')
  }

  async function importFolder() {
    if (!folder) return
    if (folder.files) return onImport(folder.files, proposal.choice)
    if (!folder.walked) return
    setPreparing(0)
    try {
      onImport(await filesOf(folder.walked, setPreparing), proposal.choice)
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
      setPreparing(null)
    }
  }

  function downloadTree() {
    const url = URL.createObjectURL(new Blob([tree], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'arbo.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /** The categories kept, created empty in MyMedia (photos can be put in them later). */
  const kept = [...new Set(albums.map((a) => proposal.categoryOf(a.name)).filter((c): c is string => !!c))]
  async function createOnly() {
    setCreating(true)
    setError(null)
    try {
      setCreated(await createCategories(kept))
    } catch (e) {
      setError(t('errors.generic', { message: (e as Error).message }))
    }
    setCreating(false)
  }

  async function sortLibrary() {
    setProgress({ done: 0, failed: 0, total: moves.length })
    setResult(await putIntoCategories(moves, (done, failed) => setProgress({ done, failed, total: moves.length })))
  }

  const busy = (progress !== null && result === null) || reading !== null || preparing !== null
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
                <button className={`btn ${source === 'computer' ? 'primary' : ''}`} disabled={busy} onClick={() => setExplain(true)}>
                  <FolderOpen size={18} /> {t('treeSuggest.fromComputer')}
                </button>
              )}
              {lone.length >= 2 && (
                <button className={`btn ${source === 'library' ? 'primary' : ''}`} disabled={busy} onClick={() => setSource('library')}>
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
                pickedFiles(e.target.files)
                e.target.value = ''
              }}
            />
            {explain && (
              <div className="browser-warning" role="alertdialog" aria-labelledby="browser-warning-title">
                <p id="browser-warning-title">
                  <strong>{t(walks ? 'treeSuggest.warnTitle' : 'treeSuggest.warnTitleUpload')}</strong>
                </p>
                <p>{t(walks ? 'treeSuggest.warnText' : 'treeSuggest.warnTextUpload')}</p>
                <div className="row">
                  <button className="btn" onClick={() => setExplain(false)}>
                    {t('common.cancel')}
                  </button>
                  <button className="btn primary" autoFocus onClick={() => void readFolder()}>
                    {t('treeSuggest.warnContinue')}
                  </button>
                </div>
              </div>
            )}
            {canPickFolder && !source && !reading && !explain && <p className="hint">{t(walks ? 'treeSuggest.computerHint' : 'treeSuggest.computerHintUpload')}</p>}
            {!canPickFolder && !source && <p className="hint">{t('treeSuggest.computerOnly')}</p>}

            {reading && (
              <p aria-live="polite">
                <Loader2 size={16} className="spin" /> {t('treeSuggest.reading', { dirs: fmt.number(reading.dirs), files: fmt.number(reading.files) })}
              </p>
            )}
            {error && <p className="error-text">{error}</p>}

            {source === 'computer' && folder && !reading && (
              <>
                <p>
                  <strong>
                    <bdi>{folder.name}</bdi>
                  </strong>
                  {' — '}
                  {t('treeSuggest.readDone', { dirs: fmt.number(folder.dirs.length), files: fmt.number(folder.paths.length), count: fromComputer.length })}
                </p>
                <details className="tree-read">
                  <summary>{t('treeSuggest.showTree', { count: folder.dirs.length })}</summary>
                  <pre dir="auto">{tree}</pre>
                  <button className="btn ghost" onClick={downloadTree}>
                    <Download size={16} /> {t('treeSuggest.downloadTree')}
                  </button>
                </details>
              </>
            )}
            {source === 'library' && <p>{t('treeSuggest.libraryIntro', { count: lone.length })}</p>}
            {source && albums.length > 0 && !reading && <CategoryProposal state={proposal} />}
            {source === 'computer' && folder && albums.length === 0 && !reading && <p className="hint">{t('autoCategories.noFolders')}</p>}
            {created && (
              <p className="ok-text" aria-live="polite">
                {t('treeSuggest.created', { count: created.count })}
                {created.existing > 0 && <> {t('treeSuggest.existing', { count: created.existing })}</>}
              </p>
            )}
            {preparing !== null && (
              <p aria-live="polite">
                <Loader2 size={16} className="spin" /> {t('treeSuggest.preparing', { done: fmt.number(preparing), total: fmt.number(folder?.paths.length ?? 0) })}
              </p>
            )}
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
            <button className="btn" disabled={busy} onClick={onClose}>
              {t('common.close')}
            </button>
            {source === 'computer' && folder && kept.length > 0 && (
              <button className="btn" disabled={busy || creating} onClick={() => void createOnly()}>
                {creating && <Loader2 size={16} className="spin" />} {t('treeSuggest.createOnly', { count: kept.length })}
              </button>
            )}
            {source === 'computer' && folder && (
              <button className="btn primary" disabled={busy || !folder.paths.length || !fromComputer.length} onClick={() => void importFolder()}>
                {t('treeSuggest.import', { count: folder.paths.length })}
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
