import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}

export function Modal({ title, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>
          <bdi>{title}</bdi>
        </h2>
        {children}
      </div>
    </div>
  )
}

interface PromptProps {
  title: string
  initial?: string
  /** Values proposed while typing. */
  suggestions?: string[]
  label?: string
  confirmLabel?: string
  validate?: (value: string) => string | null
  onSubmit: (value: string) => Promise<void>
  onClose: () => void
}

export function PromptDialog({ title, initial = '', suggestions, label, confirmLabel, validate, onSubmit, onClose }: PromptProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const v = value.trim()
    const err = !v ? t('folders.invalidName') : (validate?.(v) ?? null)
    if (err) return setError(err)
    setBusy(true)
    try {
      await onSubmit(v)
      onClose()
    } catch (ex) {
      setError(t('errors.generic', { message: (ex as Error).message }))
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          {label ?? t('common.name')}
          <input ref={input} type="text" value={value} dir="auto" list={suggestions ? 'prompt-suggestions' : undefined} onChange={(e) => setValue(e.target.value)} />
          {suggestions && (
            <datalist id="prompt-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {confirmLabel ?? t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

interface ConfirmProps {
  title: string
  text: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function ConfirmDialog({ title, text, confirmLabel, danger, onConfirm, onClose }: ConfirmProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (ex) {
      setError(t('errors.generic', { message: (ex as Error).message }))
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p>{text}</p>
      {error && <div className="error-text">{error}</div>}
      <div className="actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={confirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
