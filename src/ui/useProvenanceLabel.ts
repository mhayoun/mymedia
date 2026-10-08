import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import type { ProvenanceEntry } from '../lib/provenance'
import type { Library } from './useLibrary'

/** Labels of the Facebook groups and imports: "folder001 · 10 oct. 2026". */
export function useProvenanceLabel() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const label = (e: ProvenanceEntry) => (e.on ? `${e.label || t('provenance.looseFiles')} · ${fmt.date(`${e.on}T12:00:00`)}` : e.label)
  /** Title of the screen showing one group or import. */
  const title = (lib: Library, key: string) => {
    const e = [...lib.provenance.groups, ...lib.provenance.imports].find((x) => x.key === key)
    return e ? label(e) : ''
  }
  return { label, title }
}
