import { useEffect } from 'react'
import { useAppSettings } from '@/hooks/useAppSettings'
import { mapLocaleToLang } from '@/lib/locale'
import i18n from '@/lib/i18n'

/**
 * Syncs i18next language with whitelabel defaultLocale from app settings.
 * Renders nothing; run inside AppSettingsProvider.
 */
export function SyncLocaleFromSettings() {
  const { parsedSettings } = useAppSettings()

  useEffect(() => {
    const locale = parsedSettings.defaultLocale
    if (!locale) return
    const lang = mapLocaleToLang(locale)
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang).catch(() => {})
    }
  }, [parsedSettings.defaultLocale])

  return null
}
