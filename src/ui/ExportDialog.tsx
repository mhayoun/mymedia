import { FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../i18n/format'
import { isRtl } from '../i18n'
import { EXPORT_COLUMNS, toCsv, type ExportRow } from '../lib/exportList'
import { useApp } from '../store'
import { Modal } from './Dialog'
import type { LibraryItem } from './useLibrary'

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Export of the shown (or selected) media to Excel or CSV, in the interface language. */
export function ExportDialog({ items, title, onClose }: { items: LibraryItem[]; title: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat()
  const language = useApp((s) => s.settings.language)
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx')
  const [busy, setBusy] = useState(false)

  const headers = Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, t(`export.col.${c}`)])) as Record<keyof ExportRow, string>
  const speciesName = (i: LibraryItem) => {
    const s = i.meta?.species
    return (s && (s[language as 'he' | 'fr' | 'en'] ?? s.he ?? s.la)) ?? ''
  }
  const rows: ExportRow[] = items.map((i) => ({
    name: i.rec.name,
    date: fmt.dateTime(i.rec.takenAt),
    category: i.place.category ?? '',
    album: i.place.album ?? '',
    description: i.meta?.description ?? '',
    people: (i.meta?.people ?? []).join(', '),
    species: speciesName(i),
    origin: t(`origin.${i.meta?.origin ?? 'unknown'}`),
    size: fmt.bytes(i.rec.size),
    link: i.rec.webViewLink ?? '',
  }))
  const fileBase = `MyMedia-${new Date().toISOString().slice(0, 10)}`

  async function run() {
    setBusy(true)
    try {
      if (format === 'csv') {
        // Excel expects ";" where the decimal separator is a comma (e.g. French).
        const sep = (1.5).toLocaleString(i18n.language).includes(',') ? ';' : ','
        download(new Blob([toCsv(headers, rows, sep)], { type: 'text/csv;charset=utf-8' }), `${fileBase}.csv`)
      } else {
        const { default: writeXlsxFile } = await import('write-excel-file/browser')
        const data = [
          EXPORT_COLUMNS.map((c) => ({ value: headers[c], fontWeight: 'bold' as const })),
          ...rows.map((r) => EXPORT_COLUMNS.map((c) => ({ value: r[c] }))),
        ]
        const blob = await writeXlsxFile(data, {
          sheet: 'MyMedia',
          rightToLeft: isRtl(language),
          stickyRowsCount: 1,
          columns: [{ width: 28 }, { width: 18 }, { width: 16 }, { width: 24 }, { width: 40 }, { width: 24 }, { width: 22 }, { width: 16 }, { width: 10 }, { width: 50 }],
        }).toBlob()
        download(blob, `${fileBase}.xlsx`)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p>{t('export.intro', { count: items.length })}</p>
      <label className="radio-row">
        <input type="radio" name="fmt" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} />
        {t('export.xlsx')}
      </label>
      <label className="radio-row">
        <input type="radio" name="fmt" checked={format === 'csv'} onChange={() => setFormat('csv')} />
        {t('export.csv')}
      </label>
      <p className="hint">{t('export.columns', { list: EXPORT_COLUMNS.map((c) => headers[c]).join(', ') })}</p>
      <div className="actions">
        <button className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn primary" disabled={busy || !items.length} onClick={run}>
          <FileSpreadsheet size={16} /> {t('export.download')}
        </button>
      </div>
    </Modal>
  )
}
