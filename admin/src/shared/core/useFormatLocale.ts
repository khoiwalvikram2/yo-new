import { useAppConfig } from './AppConfigProvider'
import { getFormatLocale } from '@/shared/utils/locale'

/**
 * Returns the whitelabel locale for Intl (toLocaleString, toLocaleDateString, etc.).
 * Use instead of passing `undefined` so formatting follows super admin config.
 */
export function useFormatLocale(): string {
  const { defaultLocale } = useAppConfig()
  return getFormatLocale(defaultLocale)
}
