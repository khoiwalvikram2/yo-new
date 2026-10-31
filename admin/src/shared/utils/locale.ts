/**
 * Locale utilities for whitelabel-aware number/date formatting and i18n.
 * Use with Intl APIs: normalizeLocale(appConfig.defaultLocale).
 * Use with i18next: mapLocaleToLang(appConfig.defaultLocale).
 */

const DEFAULT_LOCALE = 'en-US'
const DEFAULT_LANG = 'en'

/**
 * Normalize whitelabel defaultLocale (e.g. "en_US", "en-US", "en") to BCP 47 for Intl.
 */
export function normalizeLocale(locale: string | null | undefined): string {
  if (!locale || typeof locale !== 'string') return DEFAULT_LOCALE
  const trimmed = locale.trim()
  if (!trimmed) return DEFAULT_LOCALE
  return trimmed.replace(/_/g, '-')
}

/**
 * Extract language code for i18next (e.g. "en_US" -> "en", "hi_IN" -> "hi").
 */
export function mapLocaleToLang(dbLocale: string | null | undefined): string {
  if (!dbLocale || typeof dbLocale !== 'string') return DEFAULT_LANG
  const normalized = normalizeLocale(dbLocale)
  const lang = normalized.split('-')[0]
  return lang || DEFAULT_LANG
}

/**
 * Get the locale to use for number/date formatting (from AppConfig or default).
 */
export function getFormatLocale(whitelabelDefaultLocale: string | null | undefined): string {
  return normalizeLocale(whitelabelDefaultLocale)
}
