import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import type { ImportInfo, ProvenanceEntry } from '../lib/provenance'
import type { Library } from './useLibrary'

/** Labels of the Facebook groups and imports. */
export function useProvenanceLabel() {
  const { t } = useTranslation()
  const fmt = useFormat()
  /** An import: "folder001 · 10 oct. 2026", or "אמא 8 · dossier Katia". */
  const importLabel = (i: ImportInfo) =>
    `${i.from || t('provenance.looseFiles')} · ${i.via === 'katia' ? t('provenance.katiaFolder') : fmt.date(`${i.on}T12:00:00`)}`
  const label = (e: ProvenanceEntry) => (e.on !== undefined ? importLabel({ from: e.label, on: e.on, via: e.via }) : e.label)
  /** Title of the screen showing one group or import. */
  const title = (lib: Library, key: string) => {
    const e = [...lib.provenance.groups, ...lib.provenance.imports].find((x) => x.key === key)
    return e ? label(e) : ''
  }
  return { label, title, importLabel }
}
