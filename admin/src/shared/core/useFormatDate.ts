import { useMemo } from 'react'
import { useAppConfig } from './AppConfigProvider'
import {
  formatDate as formatDateUtil,
  formatDateTime as formatDateTimeUtil,
  formatTime as formatTimeUtil,
} from '@/shared/services/formatting'

/**
 * Returns date/time formatters bound to the whitelabel timezone (from AppConfig).
 * Use these for all user-visible dates so they display in the tenant's timezone.
 */
export function useFormatDate() {
  const { timeZone } = useAppConfig()

  return useMemo(
    () => ({
      formatDate: (date: string | Date, formatStr?: string) =>
        formatDateUtil(date, timeZone, formatStr),
      formatDateTime: (date: string | Date, formatStr?: string) =>
        formatDateTimeUtil(date, timeZone, formatStr),
      formatTime: (date: string | Date, formatStr?: string) =>
        formatTimeUtil(date, timeZone, formatStr),
      timeZone,
    }),
    [timeZone]
  )
}
