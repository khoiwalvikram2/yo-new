import { useEffect } from 'react'
import { useAppConfig } from './AppConfigProvider'
import { mapLocaleToLang } from '@/shared/utils/locale'
import i18n from '@/lib/i18n'

/**
 * Syncs i18next language with whitelabel defaultLocale from AppConfig.
 * Renders nothing; run inside AppConfigProvider.
 */
export function SyncLocaleFromAppConfig() {
  const { defaultLocale } = useAppConfig()

  useEffect(() => {
    const lang = mapLocaleToLang(defaultLocale)
    if (i18n.language !== lang) {
      i18n.changeLanguage(lang).catch(() => {})
    }
  }, [defaultLocale])

  return null
}
