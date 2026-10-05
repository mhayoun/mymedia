// Locale-aware formatting of dates, numbers and sizes.

import { useTranslation } from 'react-i18next'
import type { Language } from '../store'
import { LOCALES } from './index'

function localeOf(lang: string): string {
  return LOCALES[lang as Language] ?? 'en-US'
}

export function formatDate(iso: string | undefined, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(localeOf(lang), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export function formatDateTime(iso: string | undefined, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(localeOf(lang), {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)
}

export function formatTime(ms: number, lang: string): string {
  return new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit' }).format(new Date(ms))
}

export function formatNumber(n: number, lang: string): string {
  return new Intl.NumberFormat(localeOf(lang)).format(n)
}

export function formatPercent(ratio: number, lang: string): string {
  return new Intl.NumberFormat(localeOf(lang), { style: 'percent', maximumFractionDigits: 0 }).format(ratio)
}

const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const

export function formatBytes(bytes: number, lang: string): string {
  let value = bytes
  let i = 0
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024
    i++
  }
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'unit',
    unit: UNITS[i],
    unitDisplay: 'short',
    maximumFractionDigits: i <= 1 ? 0 : 1,
  }).format(value)
}

export function formatDuration(ms: number, lang: string): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const nf = new Intl.NumberFormat(localeOf(lang), { minimumIntegerDigits: 2 })
  return h ? `${h}:${nf.format(m)}:${nf.format(s)}` : `${m}:${nf.format(s)}`
}

/** Formatting helpers bound to the current language. */
export function useFormat() {
  const { i18n } = useTranslation()
  const lang = i18n.language
  return {
    date: (iso?: string) => formatDate(iso, lang),
    dateTime: (iso?: string) => formatDateTime(iso, lang),
    time: (ms: number) => formatTime(ms, lang),
    number: (n: number) => formatNumber(n, lang),
    percent: (r: number) => formatPercent(r, lang),
    bytes: (n: number) => formatBytes(n, lang),
    duration: (ms: number) => formatDuration(ms, lang),
  }
}
