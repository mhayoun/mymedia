import { Check, FolderOpen, ImagePlus, Loader2, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analyze, cancelImport, mediaFiles, runImport, type ImportItem, type ImportOutcome } from '../import/importer'
import { useFormat } from '../i18n/format'
import { placementOf } from '../lib/tree'
import { useApp } from '../store'
import { AlbumSelect } from './AlbumSelect'
import { Modal } from './Dialog'
import type { Library } from './useLibrary'

interface Props {
  lib: Library
  /** Initial destination folder (album, category or root). */
  destId: string
  onClose: () => void
}

function FilePreview({ item }: { item: ImportItem }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (item.type !== 'photo' || /hei[cf]/i.test(item.mimeType)) return
    const u = URL.createObjectURL(item.file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [item])
  return (
    <span className="list-thumb">
      {url ? <img src={url} alt="" loading="lazy" /> : item.type === 'video' ? <Play size={18} className="flip-rtl" style={{ margin: 11 }} /> : null}
    </span>
  )
}

/** "Add photos/videos": choose files or a folder, check dates and sizes, upload. */
export function ImportDialog({ lib, destId: initialDest, onClose }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const rootId = useApp((s) => s.rootId)!
  const [destId, setDestId] = useState(initialDest)
  const [phase, setPhase] = useState<'pick' | 'analyze' | 'choose' | 'upload' | 'done'>('pick')
  const [analyzed, setAnalyzed] = useState({ done: 0, total: 0 })
  const [items, setItems] = useState<ImportItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [compress, setCompress] = useState(true)
  const [keepFolders, setKeepFolders] = useState(true)
  const [outcomes, setOutcomes] = useState<Record<string, ImportOutcome>>({})
  const [result, setResult] = useState<{ count: number; before: number; after: number } | null>(null)
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const canPickFolder = typeof window !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/Android|iPhone|iPad/i.test(navigator.userAgent)

  const destName = (() => {
    if (destId === rootId) return useApp.getState().settings.rootName
    const p = placementOf(destId, lib.folders, rootId)
    return [p.category, p.album].filter(Boolean).join(' / ')
  })()

  async function onFiles(list: FileList | null) {
    const files = mediaFiles([...(list ?? [])])
    if (!files.length) return
    setPhase('analyze')
    setAnalyzed({ done: 0, total: files.length })
    const result = await analyze(files, (done) => setAnalyzed({ done, total: files.length }))
    setItems(result)
    setChecked(new Set(result.filter((i) => !i.duplicate).map((i) => i.key)))
    setPhase('choose')
  }

  const selected = items.filter((i) => checked.has(i.key))
  const sizeBefore = selected.reduce((n, i) => n + i.file.size, 0)
  const sizeAfter = selected.reduce((n, i) => n + (compress && i.estimate !== null ? i.estimate : i.file.size), 0)
  const hasFolders = items.some((i) => i.relDir.length > 0)
  const duplicates = items.filter((i) => i.duplicate).length

  async function start() {
    setPhase('upload')
    const r = await runImport(selected, destId, { compress, keepFolders }, (key, o) => setOutcomes((prev) => ({ ...prev, [key]: o })))
    setResult(r)
    setPhase('done')
  }

  const toggle = (key: string) =>
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const status = (i: ImportItem) => {
    const o = outcomes[i.key]
    if (phase === 'choose' || !checked.has(i.key)) {
      if (i.duplicate) return <span className="tag warn">{t('import.duplicate')}</span>
      return compress && i.estimate !== null ? (
        <>
          {fmt.bytes(i.file.size)} → ≈ {fmt.bytes(i.estimate)}
        </>
      ) : (
        fmt.bytes(i.file.size)
      )
    }
    if (!o || o.status === 'waiting') return <span className="hint">{t('compress.waiting')}</span>
    if (o.status === 'compressing')
      return (
        <>
          <Loader2 size={14} className="spin" /> {t('import.compressing')} {o.progress ? fmt.percent(o.progress) : ''}
        </>
      )
    if (o.status === 'uploading')
      return (
        <>
          <Loader2 size={14} className="spin" /> {t('import.uploading')} {fmt.percent(o.progress)}
        </>
      )
    if (o.status === 'done')
      return (
        <span className="ok-text">
          <Check size={14} /> {fmt.bytes(o.size)}
        </span>
      )
    return (
      <span className="error-text">
        <X size={14} /> {t('compress.failed')}
      </span>
    )
  }

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.takenAt.localeCompare(b.takenAt)), [items])

  return (
    <Modal wide title={t('import.title')} onClose={phase === 'upload' ? () => undefined : onClose}>
      <div className="row" style={{ marginBlockEnd: 10 }}>
        <span>{t('import.to')}</span>
        <strong>
          <bdi>{destName}</bdi>
        </strong>
        {(phase === 'pick' || phase === 'choose') && (
          <AlbumSelect
            categories={lib.categories}
            placeholder={t('import.changeDest')}
            onChoose={setDestId}
            exclude={destId}
          />
        )}
      </div>

      {phase === 'pick' && (
        <>
          <p>{t('import.intro')}</p>
          <div className="row">
            <button className="btn primary" onClick={() => filesInput.current?.click()}>
              <ImagePlus size={18} /> {t('import.chooseFiles')}
            </button>
            {canPickFolder && (
              <button className="btn" onClick={() => folderInput.current?.click()}>
                <FolderOpen size={18} /> {t('import.chooseFolder')}
              </button>
            )}
          </div>
          <p className="hint">{t('import.dateHint')}</p>
          <input ref={filesInput} type="file" multiple hidden accept="image/*,video/*,.heic,.heif,.mov" onChange={(e) => onFiles(e.target.files)} />
          <input
            ref={folderInput}
            type="file"
            hidden
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => onFiles(e.target.files)}
          />
        </>
      )}

      {phase === 'analyze' && (
        <>
          <p>{t('import.analyzing', { done: analyzed.done, total: analyzed.total })}</p>
          <progress max={analyzed.total} value={analyzed.done} style={{ inlineSize: '100%' }} />
        </>
      )}

      {(phase === 'choose' || phase === 'upload' || phase === 'done') && (
        <>
          <ul className="compress-list">
            {sortedItems.map((i) => (
              <li key={i.key} className={checked.has(i.key) ? '' : 'off'}>
                <label>
                  <input type="checkbox" checked={checked.has(i.key)} disabled={phase !== 'choose'} onChange={() => toggle(i.key)} />
                  <FilePreview item={i} />
                  <span className="name" title={i.file.name}>
                    <bdi>{i.file.name}</bdi>
                    <br />
                    <span className="hint">
                      {fmt.dateTime(i.takenAt)} · {t(`import.source.${i.dateSource}`)}
                      {i.relDir.length > 0 && keepFolders && (
                        <>
                          {' · '}
                          <bdi>{i.relDir.join(' / ')}</bdi>
                        </>
                      )}
                    </span>
                  </span>
                </label>
                <span className="sizes">{status(i)}</span>
              </li>
            ))}
          </ul>
          {phase === 'choose' && (
            <>
              <label className="radio-row">
                <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
                {t('import.compress')}
              </label>
              {hasFolders && (
                <label className="radio-row">
                  <input type="checkbox" checked={keepFolders} onChange={(e) => setKeepFolders(e.target.checked)} />
                  {t('import.keepFolders')}
                </label>
              )}
              {duplicates > 0 && <p className="hint">{t('import.duplicatesHint', { count: duplicates })}</p>}
              <p>
                <strong>
                  {t('compress.selection', { count: selected.length })}: {fmt.bytes(sizeBefore)}
                  {compress && sizeAfter < sizeBefore ? <> → ≈ {fmt.bytes(sizeAfter)}</> : null}
                </strong>
              </p>
            </>
          )}
          {phase === 'done' && result && (
            <p>
              <strong>
                {t('import.done', { count: result.count, before: fmt.bytes(result.before), after: fmt.bytes(result.after) })}
              </strong>
            </p>
          )}
        </>
      )}

      <div className="actions">
        {phase === 'choose' && (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={!selected.length} onClick={start}>
              {t('import.uploadN', { count: selected.length })}
            </button>
          </>
        )}
        {phase === 'upload' && (
          <button className="btn" onClick={cancelImport}>
            {t('common.cancel')}
          </button>
        )}
        {(phase === 'done' || phase === 'pick') && (
          <button className={`btn ${phase === 'done' ? 'primary' : ''}`} onClick={onClose}>
            {phase === 'done' ? t('common.ok') : t('common.cancel')}
          </button>
        )}
      </div>
    </Modal>
  )
}
