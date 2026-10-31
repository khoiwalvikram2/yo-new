import type { LanguageCode } from '@/types'
import i18n from './i18n'

const LANGUAGE_STORAGE_KEY = 'stakex_language'
const DEFAULT_INTL_LOCALE = 'en-IN'

/**
 * Normalize whitelabel defaultLocale (e.g. "en_US", "en-US") to BCP 47 for Intl.
 */
export function normalizeLocale(locale: string | null | undefined): string {
  if (!locale || typeof locale !== 'string') return DEFAULT_INTL_LOCALE
  const trimmed = locale.trim().replace(/_/g, '-')
  return trimmed || DEFAULT_INTL_LOCALE
}

/**
 * Extract language code for i18next (e.g. "en_US" -> "en", "hi_IN" -> "hi").
 */
export function mapLocaleToLang(dbLocale: string | null | undefined): LanguageCode {
  if (!dbLocale || typeof dbLocale !== 'string') return 'en'
  const normalized = normalizeLocale(dbLocale)
  const lang = normalized.split('-')[0] as LanguageCode
  return (lang === 'en' || lang === 'hi' || lang === 'ta' || lang === 'te' ? lang : 'en') as LanguageCode
}

export function getLanguageFromStorage(): LanguageCode {
  if (typeof window === 'undefined') return 'en'
  const v = window.localStorage.getItem(LANGUAGE_STORAGE_KEY) as LanguageCode | null
  return (v as LanguageCode) || 'en'
}

export function setLanguageToStorage(code: LanguageCode) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
}

export function applyLanguage(code: LanguageCode) {
  setLanguageToStorage(code)
  i18n.changeLanguage(code)
}


