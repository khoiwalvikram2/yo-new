// Formatting utilities for the application

import { formatInTimeZone } from '@/shared/utils/date'

const DEFAULT_TZ = 'UTC'

/** Format date only (e.g. "DD MMM YYYY"). Pass timeZone from useAppConfig().timeZone for whitelabel. */
export function formatDate(
  date: string | Date,
  timeZone: string = DEFAULT_TZ,
  formatStr: string = 'dd MMM yyyy'
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return 'Invalid Date'
  return formatInTimeZone(d, formatStr, timeZone)
}

/** Format date and time (e.g. "DD MMM YYYY HH:mm"). Pass timeZone from useAppConfig().timeZone for whitelabel. */
export function formatDateTime(
  date: string | Date,
  timeZone: string = DEFAULT_TZ,
  formatStr: string = 'dd MMM yyyy HH:mm'
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return 'Invalid Date'
  return formatInTimeZone(d, formatStr, timeZone)
}

/** Format time only (e.g. "HH:mm"). Pass timeZone from useAppConfig().timeZone for whitelabel. */
export function formatTime(
  date: string | Date,
  timeZone: string = DEFAULT_TZ,
  formatStr: string = 'HH:mm'
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return 'Invalid Date'
  return formatInTimeZone(d, formatStr, timeZone)
}

// Date Formatting (legacy object; prefer formatDate/formatDateTime/formatTime with timeZone)
function legacyFormatToDateFns(format: string): string {
  if (format.includes('HH:mm:ss')) return 'dd MMM yyyy HH:mm:ss'
  if (format.includes('HH:mm')) return 'dd MMM yyyy HH:mm'
  if (format === 'MMM DD, YYYY') return 'MMM dd, yyyy'
  return 'dd MMM yyyy'
}

export const dateFormatter = {
  format: (date: string | Date, format: string = 'MMM DD, YYYY', timeZone?: string): string => {
    const d = new Date(date)
    if (isNaN(d.getTime())) return 'Invalid Date'
    const tz = timeZone ?? DEFAULT_TZ
    return formatInTimeZone(d, legacyFormatToDateFns(format), tz)
  },

  formatRelative: (date: string | Date): string => {
    const d = new Date(date)
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000)

    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`
    
    return dateFormatter.format(d)
  },

  formatDuration: (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`
    } else {
      return `${secs}s`
    }
  },
}

// Number Formatting
export const numberFormatter = {
  format: (value: number, options: {
    decimals?: number
    currency?: string
    compact?: boolean
    sign?: boolean
  } = {}): string => {
    const { decimals = 2, currency, compact = false, sign = false } = options

    let formatted = value.toFixed(decimals)

    if (compact && Math.abs(value) >= 1000) {
      const suffixes = ['', 'K', 'M', 'B', 'T']
      const magnitude = Math.floor(Math.log10(Math.abs(value)) / 3)
      const scaled = value / Math.pow(1000, magnitude)
      formatted = scaled.toFixed(decimals) + suffixes[magnitude]
    }

    if (currency) {
      const symbol = getCurrencySymbol(currency)
      formatted = `${symbol}${formatted}`
    }

    if (sign && value > 0) {
      formatted = `+${formatted}`
    }

    return formatted
  },

  formatPercentage: (value: number, decimals: number = 1): string => {
    return `${value.toFixed(decimals)}%`
  },

  formatRatio: (value: number, decimals: number = 2): string => {
    return value.toFixed(decimals)
  },
}

// Currency Formatting
export const currencyFormatter = {
  format: (amount: number, currency: string = 'USD', options: {
    decimals?: number
    showSymbol?: boolean
    showCode?: boolean
  } = {}): string => {
    const { decimals = 2, showSymbol = true, showCode = false } = options

    const symbol = getCurrencySymbol(currency)
    const formatted = amount.toFixed(decimals)

    if (showSymbol && showCode) {
      return `${symbol}${formatted} ${currency}`
    } else if (showSymbol) {
      return `${symbol}${formatted}`
    } else if (showCode) {
      return `${formatted} ${currency}`
    } else {
      return formatted
    }
  },

  formatCompact: (amount: number, currency: string = 'USD'): string => {
    const symbol = getCurrencySymbol(currency)
    
    if (Math.abs(amount) >= 1000000) {
      return `${symbol}${(amount / 1000000).toFixed(1)}M`
    } else if (Math.abs(amount) >= 1000) {
      return `${symbol}${(amount / 1000).toFixed(1)}K`
    } else {
      return `${symbol}${amount.toFixed(0)}`
    }
  },
}

// Text Formatting
export const textFormatter = {
  capitalize: (text: string): string => {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
  },

  capitalizeWords: (text: string): string => {
    return text.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    )
  },

  truncate: (text: string, length: number = 50, suffix: string = '...'): string => {
    if (text.length <= length) return text
    return text.substring(0, length) + suffix
  },

  slugify: (text: string): string => {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
  },

  maskEmail: (email: string): string => {
    const [local, domain] = email.split('@')
    if (local.length <= 2) return email
    
    const maskedLocal = local.charAt(0) + '*'.repeat(local.length - 2) + local.charAt(local.length - 1)
    return `${maskedLocal}@${domain}`
  },

  maskPhone: (phone: string): string => {
    if (phone.length <= 4) return phone
    
    const visible = phone.slice(-4)
    const masked = '*'.repeat(phone.length - 4)
    return masked + visible
  },
}

// File Size Formatting
export const fileSizeFormatter = {
  format: (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'

    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  },
}

// Status Formatting
export const statusFormatter = {
  format: (status: string): string => {
    return textFormatter.capitalizeWords(status.replace(/_/g, ' '))
  },

  getColor: (status: string): string => {
    const statusColors: Record<string, string> = {
      active: 'text-green-600',
      inactive: 'text-gray-600',
      pending: 'text-yellow-600',
      suspended: 'text-red-600',
      deleted: 'text-red-800',
      success: 'text-green-600',
      error: 'text-red-600',
      warning: 'text-yellow-600',
      info: 'text-blue-600',
    }

    return statusColors[status.toLowerCase()] || 'text-gray-600'
  },

  getBadgeColor: (status: string): string => {
    const badgeColors: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      pending: 'bg-yellow-100 text-yellow-800',
      suspended: 'bg-red-100 text-red-800',
      deleted: 'bg-red-200 text-red-900',
      success: 'bg-green-100 text-green-800',
      error: 'bg-red-100 text-red-800',
      warning: 'bg-yellow-100 text-yellow-800',
      info: 'bg-blue-100 text-blue-800',
    }

    return badgeColors[status.toLowerCase()] || 'bg-gray-100 text-gray-800'
  },
}

// Helper function to get currency symbol
const getCurrencySymbol = (currency: string): string => {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    INR: '₹',
    CAD: 'C$',
    AUD: 'A$',
    CHF: 'CHF',
    CNY: '¥',
    KRW: '₩',
  }

  return symbols[currency] || currency
}

// Export all formatters
export const formatters = {
  date: dateFormatter,
  number: numberFormatter,
  currency: currencyFormatter,
  text: textFormatter,
  fileSize: fileSizeFormatter,
  status: statusFormatter,
}
