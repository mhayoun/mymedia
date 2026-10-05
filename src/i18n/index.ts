import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import he from './locales/he.json'
import type { Language } from '../store'

export const LANGUAGES: Language[] = ['he', 'fr', 'en']
const RTL = new Set<Language>(['he'])

/** BCP-47 locale used for dates, numbers and sizes. */
export const LOCALES: Record<Language, string> = { he: 'he-IL', fr: 'fr-FR', en: 'en-US' }

export function isRtl(lang: Language): boolean {
  return RTL.has(lang)
}

export function applyDocumentLanguage(lang: Language) {
  document.documentElement.lang = lang
  document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr'
}

export function initI18n(lang: Language) {
  applyDocumentLanguage(lang)
  return i18n.use(initReactI18next).init({
    resources: { he: { translation: he }, fr: { translation: fr }, en: { translation: en } },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnObjects: false,
  })
}

export async function changeLanguage(lang: Language) {
  applyDocumentLanguage(lang)
  await i18n.changeLanguage(lang)
}

export default i18n
