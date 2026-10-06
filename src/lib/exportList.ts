// Export of the media list to CSV (pure part, tested).

export interface ExportRow {
  name: string
  date: string
  category: string
  album: string
  description: string
  people: string
  species: string
  origin: string
  size: string
  link: string
}

export const EXPORT_COLUMNS: (keyof ExportRow)[] = ['name', 'date', 'category', 'album', 'description', 'people', 'species', 'origin', 'size', 'link']

function cell(v: string, sep: string): string {
  return /["\r\n]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * CSV that Excel opens correctly: UTF-8 with BOM (Hebrew), and ";" as
 * separator where Excel expects it (French and other comma-decimal locales).
 */
export function toCsv(headers: Record<keyof ExportRow, string>, rows: ExportRow[], sep: ',' | ';'): string {
  const lines = [EXPORT_COLUMNS.map((c) => cell(headers[c], sep)).join(sep)]
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => cell(r[c], sep)).join(sep))
  return '﻿' + lines.join('\r\n') + '\r\n'
}
