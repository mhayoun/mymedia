import { Component, type ReactNode } from 'react'
import i18n from 'i18next'

/** Instead of a white page when the app breaks: what went wrong and a button to reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[MyMedia] the page broke', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 24, maxInlineSize: 600, margin: '0 auto' }}>
        <h2>{i18n.t('errors.crashTitle')}</h2>
        <p>{i18n.t('errors.crashText')}</p>
        <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{error.message}</pre>
        <button className="btn primary" onClick={() => location.reload()}>
          {i18n.t('errors.reload')}
        </button>
      </div>
    )
  }
}
