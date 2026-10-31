/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { getAppSettings, getAppSettingsVersion, getAdvertisements } from './api/user'
import { useAuth } from './auth'
import { getWhitelabelId } from './whitelabel'
import { toast } from 'sonner'
import { setWhitelabelCurrencyDefaults } from './currency'
import { setWhitelabelTimezone } from './dateUtils'
import { normalizeLocale } from './locale'

// Cache configuration
const CACHE_KEY = 'app_settings_cache'
const CACHE_VERSION = '1.4' // Owner-scoped settings and cacheable image URLs
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes (fast initial render only)
const POLLING_INTERVAL = 5 * 1000 // 5 seconds (near-instant admin updates)
const MAX_RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY = 1000 // 1 second
const DEFAULT_FAVICON_PATH = '/nova/favicon.svg'

// Cache structure
type SettingsCache = {
  owner: string
  settings: ParsedAppSettings
  timestamp: number
  version: string
}

// Derive lighter/darker/rgba from a hex color for whitelabel primary family
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace(/^#/, '').match(/([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/)
  if (!match) return null
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  }
}
function lightenHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * (percent / 100)))
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * (percent / 100)))
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * (percent / 100)))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
function darkenHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const r = Math.max(0, Math.round(rgb.r * (1 - percent / 100)))
  const g = Math.max(0, Math.round(rgb.g * (1 - percent / 100)))
  const b = Math.max(0, Math.round(rgb.b * (1 - percent / 100)))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

// Helper to parse JSON strings safely
const parseJson = (value: string | null | undefined): any => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

// Parse JSON-like fields where non-object values should be treated as absent.
const parseObjectOrNull = (value: string | null | undefined): Record<string, any> | null => {
  const parsed = parseJson(value)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, any>
  }
  return null
}

// Helper to parse boolean strings
const parseBoolean = (value: string | null | undefined): boolean => {
  if (!value) return false
  return value === 'true'
}

// Helper to parse numeric strings
const parseNumber = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const num = Number(value)
  return isNaN(num) ? null : num
}

// Zod schema for validation
const appFeaturesSchema = z.object({
  sportsEnabled: z.boolean(),
  casinoEnabled: z.boolean(),
  matkaEnabled: z.boolean(),
  agentsEnabled: z.boolean(),
  referralsEnabled: z.boolean(),
  bonusesEnabled: z.boolean(),
  registerEnabled: z.boolean(),
  /** Live TV & Score Card URLs: only for grandwinn-com; kondareddi-com and others get false (server-controlled). */
  liveTvAndScoreCardEnabled: z.boolean().optional(),
})

const paymentsConfigSchema = z.object({
  depositMin: z.number().nullable().optional(),
  depositMax: z.number().nullable().optional(),
  withdrawalMin: z.number().nullable().optional(),
  withdrawalMax: z.number().nullable().optional(),
  depositFeePercent: z.number().nullable().optional(),
  withdrawalFeePercent: z.number().nullable().optional(),
  kycRequiredToWithdraw: z.boolean().optional(),
  roundingStrategy: z.string().nullable().optional(),
  upiPayoutsDisabled: z.boolean().optional(),
  bankPayoutsDisabled: z.boolean().optional(),
  hideAddUpi: z.boolean().optional(),
  hideAddBank: z.boolean().optional(),
  // Listed so the parse keeps it: zod drops unknown keys, which silently disabled the withdrawal page's
  // daily-request banner and pre-submit cap (the backend still enforces the limit).
  maxDailyWithdrawalRequests: z.number().nullable().optional(),
})

const riskConfigSchema = z.object({
  overallExposureCap: z.number().nullable().optional(),
  dailyStakeLimit: z.number().nullable().optional(),
  weeklyStakeLimit: z.number().nullable().optional(),
  cashoutEnabled: z.boolean().default(true),
})

// Lenient: API may return theme as JSON with mixed types; accept any object shape
const whitelabelThemeSchema = z.record(z.string(), z.any()).nullable().optional()

const parsedAppSettingsSchema = z.object({
  appName: z.string().default(''),
  supportEmail: z.string().nullable().optional(),
  supportPhone: z.string().nullable().optional(),
  whatsappSupportPhone: z.string().nullable().optional(),
  defaultLocale: z.string().nullable().optional(),
  timeZone: z.string().nullable().optional(),
  baseCurrency: z.string().default('INR'),
  primaryDomain: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  faviconUrl: z.string().nullable().optional(),
  whitelabelTheme: whitelabelThemeSchema,
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
  ogImageUrl: z.string().nullable().optional(),
  socialLinks: z.record(z.string(), z.any()).nullable().optional(),
  analytics: z.record(z.string(), z.any()).nullable().optional(),
  maintenance: z.boolean().default(false),
  maintenanceMessage: z.string().nullable().optional(),
  newsTicker: z.string().nullable().optional(),
  features: appFeaturesSchema.default({
    sportsEnabled: true,
    casinoEnabled: true,
    matkaEnabled: true,
    agentsEnabled: true,
    referralsEnabled: true,
    bonusesEnabled: true,
    registerEnabled: true,
    liveTvAndScoreCardEnabled: false,
  }),
  payments: paymentsConfigSchema.default({}),
  risk: riskConfigSchema.default({ cashoutEnabled: true }),
  domains: z.record(z.string(), z.any()).nullable().optional(),
  pwa: z.record(z.string(), z.any()).nullable().optional(),
  logoImg: z.string().nullable().optional(),
  siteTitle: z.string().default('App'),
  color: z.string().nullable().optional(),
  faviconImg: z.string().nullable().optional(),
  hideDW: z.boolean().optional(),
})

// Convert key-value array to structured settings object
const parseSettingsArray = (settingsArray: Array<{ key: string; value: string | null }> | null | undefined): ParsedAppSettings => {
  if (!settingsArray || !Array.isArray(settingsArray)) {
    return getDefaultSettings()
  }

  const settingsMap = new Map<string, string | null>()
  settingsArray.forEach(({ key, value }) => {
    settingsMap.set(key, value)
  })

  const get = (key: string) => settingsMap.get(key) ?? null

  const parsed: ParsedAppSettings = {
    // App identity — backend is the only source; blank stays blank (no fallback).
    appName: get('appName') ?? '',
    supportEmail: get('supportEmail'),
    supportPhone: get('supportPhone'),
    whatsappSupportPhone: get('whatsappSupportPhone'),
    defaultLocale: get('defaultLocale'),
    timeZone: get('timeZone'),
    baseCurrency: get('baseCurrency') || 'INR',
    
    // Branding & Theme (from whitelabel)
    primaryDomain: get('primaryDomain'),
    logoUrl: get('logoUrl'),
    faviconUrl: get('faviconUrl'),
    whitelabelTheme: parseObjectOrNull(get('whitelabelTheme')),
    
    // SEO & Social
    seoTitle: get('seoTitle'),
    seoDescription: get('seoDescription'),
    ogImageUrl: get('ogImageUrl'),
    socialLinks: (() => {
      const parsed = parseObjectOrNull(get('socialLinks'))
      if (!parsed || typeof parsed !== 'object') return null
      // Filter out null values from social links
      const filtered: Record<string, string> = {}
      Object.entries(parsed).forEach(([key, value]) => {
        if (value !== null && value !== undefined && typeof value === 'string') {
          filtered[key] = value
        }
      })
      return Object.keys(filtered).length > 0 ? filtered : null
    })(),
    
    // Analytics
    analytics: parseObjectOrNull(get('analytics')),
    
    // Maintenance
    maintenance: parseBoolean(get('maintenance')),
    maintenanceMessage: get('maintenanceMessage'),
    // Admin > Maintenance > News Ticker: scrolling header text, hidden when empty
    newsTicker: get('newsTicker'),

    // Feature toggles
    features: {
      sportsEnabled: parseBoolean(get('sportsEnabled')),
      casinoEnabled: parseBoolean(get('casinoEnabled')),
      matkaEnabled: parseBoolean(get('matkaEnabled')),
      agentsEnabled: parseBoolean(get('agentsEnabled')),
      referralsEnabled: parseBoolean(get('referralsEnabled')),
      bonusesEnabled: parseBoolean(get('bonusesEnabled')),
      // Default true: register works unless the whitelabel explicitly disables it.
      registerEnabled: get('registerEnabled') == null ? true : parseBoolean(get('registerEnabled')),
      liveTvAndScoreCardEnabled: parseBoolean(get('liveTvAndScoreCardEnabled')) ?? false,
    },
    
    // Payment configuration
    payments: {
      depositMin: parseNumber(get('depositMin')),
      depositMax: parseNumber(get('depositMax')),
      withdrawalMin: parseNumber(get('withdrawalMin')),
      withdrawalMax: parseNumber(get('withdrawalMax')),
      depositFeePercent: parseNumber(get('depositFeePercent')),
      withdrawalFeePercent: parseNumber(get('withdrawalFeePercent')),
      kycRequiredToWithdraw: parseBoolean(get('kycRequiredToWithdraw')),
      roundingStrategy: get('roundingStrategy'),
      upiPayoutsDisabled: parseBoolean(get('upiPayoutsDisabled')),
      bankPayoutsDisabled: parseBoolean(get('bankPayoutsDisabled')),
      hideAddUpi: parseBoolean(get('hideAddUpi')),
      hideAddBank: parseBoolean(get('hideAddBank')),
      maxDailyWithdrawalRequests: parseNumber(get('maxDailyWithdrawalRequests')),
    },
    
    // Risk defaults
    risk: {
      overallExposureCap: parseNumber(get('overallExposureCap')),
      dailyStakeLimit: parseNumber(get('dailyStakeLimit')),
      weeklyStakeLimit: parseNumber(get('weeklyStakeLimit')),
      cashoutEnabled: parseBoolean(get('cashoutEnabled')),
    },
    
    // Domains config
    domains: parseObjectOrNull(get('domains')),
    
    // PWA config
    pwa: parseObjectOrNull(get('pwa')),
    
    // Legacy fields (for backward compatibility)
    logoImg: get('logoUrl'), // Use whitelabel logoUrl
    siteTitle: get('seoTitle') || get('appName') || '',
    color: parseObjectOrNull(get('whitelabelTheme'))?.primary || null, // Use theme primary color
    faviconImg: get('faviconUrl'), // Use whitelabel faviconUrl
    
    // Agent credit settings
    hideDW: parseBoolean(get('hideDW')) ?? false,
  }

  // Validate with Zod; use safeParse so we never throw and can merge fallbacks
  const result = parsedAppSettingsSchema.safeParse(parsed)
  if (result.success) {
    return result.data
  }
  // Log validation issues in dev only; still return merged data so logo/favicon/SEO work
  if (process.env.NODE_ENV === 'development') {
    const paths = result.error.issues.map((e) => e.path.join('.')).filter(Boolean)
    console.warn('[AppSettings] Validation issues (using merged defaults):', paths.length ? paths.join(', ') : result.error.issues)
  }
  return {
    ...getDefaultSettings(),
    ...parsed,
    appName: parsed.appName ?? '',
    baseCurrency: parsed.baseCurrency || 'INR',
    siteTitle: parsed.siteTitle || parsed.appName || '',
    maintenance: parsed.maintenance ?? false,
    features: parsed.features || getDefaultSettings().features,
    payments: parsed.payments || getDefaultSettings().payments,
    risk: parsed.risk || getDefaultSettings().risk,
  } as ParsedAppSettings
}

const getDefaultSettings = (): ParsedAppSettings => ({
  appName: '',
  baseCurrency: 'INR',
  maintenance: false,
  features: {
    sportsEnabled: true,
    casinoEnabled: true,
    matkaEnabled: true,
    agentsEnabled: true,
    referralsEnabled: true,
    bonusesEnabled: true,
    registerEnabled: true,
    liveTvAndScoreCardEnabled: false,
  },
  risk: {
    cashoutEnabled: true,
  },
  payments: {},
  logoImg: null,
  siteTitle: '',
  color: null,
  faviconImg: null,
  hideDW: false,
})

// Cache helpers
const getCachedSettings = (owner: string): ParsedAppSettings | null => {
  if (typeof window === 'undefined') return null
  
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return null
    
    const parsed: SettingsCache = JSON.parse(cached)
    
    // Check version
    if (parsed.version !== CACHE_VERSION || parsed.owner !== owner) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    
    // Check TTL
    const age = Date.now() - parsed.timestamp
    if (age > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    
    return parsed.settings
  } catch {
    try { localStorage.removeItem(CACHE_KEY) } catch { /* Storage can be disabled. */ }
    return null
  }
}

const setCachedSettings = (settings: ParsedAppSettings, owner: string): void => {
  if (typeof window === 'undefined') return
  
  try {
    const cache: SettingsCache = {
      owner,
      settings,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch (_error) {
    // Failed to cache settings
  }
}

const clearCache = (): void => {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(CACHE_KEY) } catch { /* Storage can be disabled. */ }
}

export type AppFeatures = {
  sportsEnabled: boolean
  casinoEnabled: boolean
  matkaEnabled: boolean
  agentsEnabled: boolean
  referralsEnabled: boolean
  bonusesEnabled: boolean
  registerEnabled: boolean
  /** true only for grandwinn-com; kondareddi-com and others get false (server). */
  liveTvAndScoreCardEnabled?: boolean
}

export type PaymentsConfig = {
  depositMin?: number | null
  depositMax?: number | null
  withdrawalMin?: number | null
  withdrawalMax?: number | null
  depositFeePercent?: number | null
  withdrawalFeePercent?: number | null
  kycRequiredToWithdraw?: boolean
  roundingStrategy?: string | null
  upiPayoutsDisabled?: boolean
  bankPayoutsDisabled?: boolean
  hideAddUpi?: boolean
  hideAddBank?: boolean
  maxDailyWithdrawalRequests?: number | null
}

export type RiskConfig = {
  overallExposureCap?: number | null
  dailyStakeLimit?: number | null
  weeklyStakeLimit?: number | null
  cashoutEnabled: boolean
}

export type WhitelabelTheme = {
  // Action colors (shared for both themes)
  primary?: string
  success?: string
  warning?: string
  danger?: string
  // Dark theme colors
  dark?: {
    bgPage?: string
    textPrimary?: string
    textSecondary?: string
    border?: string
  }
  // Light theme colors
  light?: {
    bgPage?: string
    textPrimary?: string
    textSecondary?: string
    border?: string
  }
  // Legacy support - if dark/light not provided, use these
  bgPage?: string
  textPrimary?: string
  textSecondary?: string
  border?: string
}

export type ParsedAppSettings = {
  // App identity
  appName: string
  supportEmail?: string | null
  supportPhone?: string | null
  whatsappSupportPhone?: string | null
  defaultLocale?: string | null
  timeZone?: string | null
  baseCurrency: string
  
  // Branding & Theme (from whitelabel)
  primaryDomain?: string | null
  logoUrl?: string | null
  faviconUrl?: string | null
  whitelabelTheme?: WhitelabelTheme | null
  
  // SEO & Social
  seoTitle?: string | null
  seoDescription?: string | null
  ogImageUrl?: string | null
  socialLinks?: Record<string, string> | null
  
  // Analytics
  analytics?: Record<string, any> | null
  
  // Maintenance
  maintenance: boolean
  maintenanceMessage?: string | null
  newsTicker?: string | null

  // Feature toggles
  features: AppFeatures
  
  // Payment configuration
  payments: PaymentsConfig
  
  // Risk defaults
  risk: RiskConfig
  
  // Domains config
  domains?: Record<string, any> | null
  
  // PWA config
  pwa?: Record<string, any> | null
  
  // Legacy fields (for backward compatibility)
  logoImg?: string | null
  siteTitle: string
  color?: string | null
  faviconImg?: string | null
  
  // Agent credit settings
  hideDW?: boolean
}

type AppSettings = {
  logoImg?: string | null
  siteTitle?: string
  color?: string
  faviconImg?: string | null
  [key: string]: any
}

type Advertisement = {
  _id?: string
  id: string
  title: string
  subtitle?: string
  baseImage?: string
  image: string
  type?: string
  url?: string
  order?: number
  status?: string
  deviceType?: string
  [key: string]: any
}

type AppSettingsContextType = {
  appSettings: AppSettings | null
  parsedSettings: ParsedAppSettings
  allAppSettings: any | null
  advertisements: Advertisement[]
  isLoading: boolean
  error: Error | null
  lastRefreshTime: number | null
  refreshAppSettings: () => Promise<void>
  refreshAdvertisements: () => Promise<void>
  clearCache: () => void
}

const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth()
  const ownerKey = `${getWhitelabelId()}:${isAuthenticated ? user?.id || 'pending' : 'anonymous'}`
  const owner = useRef(ownerKey)
  owner.current = ownerKey
  const [loadedOwner, setLoadedOwner] = useState('')
  const settingsRevision = useRef<{ owner: string; version?: string }>({ owner: '' })
  const settingsInFlight = useRef<{ owner: string; promise: Promise<void> } | null>(null)
  const revisionInFlight = useRef<object | null>(null)
  const adsGeneration = useRef(0)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [parsedSettings, setParsedSettings] = useState<ParsedAppSettings>(() => {
    // Try to load from cache on initial mount
    const cached = getCachedSettings(ownerKey)
    return cached || getDefaultSettings()
  })
  const [allAppSettings, setAllAppSettings] = useState<any | null>(null)
  const [advertisements, setAdvertisements] = useState<Advertisement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [lastRefreshTime, setLastRefreshTime] = useState<number | null>(null)
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef(0)

  // Sync whitelabel currency and timezone to libs when settings change
  useEffect(() => {
    setWhitelabelCurrencyDefaults(
      parsedSettings.baseCurrency,
      parsedSettings.defaultLocale != null ? normalizeLocale(parsedSettings.defaultLocale) : undefined
    )
    setWhitelabelTimezone(parsedSettings.timeZone ?? 'Asia/Kolkata')
  }, [parsedSettings.baseCurrency, parsedSettings.defaultLocale, parsedSettings.timeZone])

  // Retry helper with exponential backoff
  const retryWithBackoff = async <T,>(
    fn: () => Promise<T>,
    attempts: number = MAX_RETRY_ATTEMPTS
  ): Promise<T> => {
    for (let i = 0; i < attempts; i++) {
    try {
        return await fn()
      } catch (err) {
        if (i === attempts - 1) throw err
        const delay = RETRY_BASE_DELAY * Math.pow(2, i)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    throw new Error('Max retries exceeded')
  }

  // Apply theme colors to CSS variables
  const applyTheme = (parsed: ParsedAppSettings) => {
    if (typeof document === 'undefined') return

    const theme = parsed.whitelabelTheme
    const root = document.documentElement

    if (!theme) {
      return
    }

    const isDark = root.classList.contains('dark')

    // Get theme colors based on current mode with robust fallbacks
    const themeColors = isDark ? theme.dark : theme.light
    
    // If dark/light structure not available, use CSS default values (match index.css)
    const defaultDark = {
      bgPage: '#101826',
      textPrimary: '#E8EDF6',
      textSecondary: '#A0AEC3',
      border: '#2B3A50',
    }
    
    const defaultLight = {
      bgPage: '#F4F6FA',
      textPrimary: '#18243A',
      textSecondary: '#64748B',
      border: '#DDE4EF',
    }
    
    const defaults = isDark ? defaultDark : defaultLight
    
    // Legacy unqualified palettes were dark-only. Do not paint the light mode dark.
    const bgPage = themeColors?.bgPage || (isDark ? theme.bgPage : undefined) || defaults.bgPage
    const textPrimary = themeColors?.textPrimary || (isDark ? theme.textPrimary : undefined) || defaults.textPrimary
    const textSecondary = themeColors?.textSecondary || (isDark ? theme.textSecondary : undefined) || defaults.textSecondary
    const border = themeColors?.border || (isDark ? theme.border : undefined) || defaults.border

    // Apply action colors (shared for both themes)
    // Admin whitelabel primary → full brand-primary family in user1 so buttons/hovers match
    if (theme.primary) {
      root.style.setProperty('--brand-primary', theme.primary)
      root.style.setProperty('--brand-primary-light', lightenHex(theme.primary, 18))
      root.style.setProperty('--brand-primary-dark', darkenHex(theme.primary, 15))
      root.style.setProperty('--brand-primary-shadow', hexToRgba(theme.primary, 0.3))
      root.style.setProperty('--brand-primary-shadow-light', hexToRgba(theme.primary, 0.08))
      // Legacy alias used in CSS
      root.style.setProperty('--primary', theme.primary)
    }
    if (theme.success) {
      root.style.setProperty('--brand-success', theme.success)
    }
    if (theme.warning) {
      root.style.setProperty('--brand-warning', theme.warning)
    }
    if (theme.danger) {
      root.style.setProperty('--brand-danger', theme.danger)
    }

    // Apply UI colors based on current theme mode
    if (bgPage) {
      root.style.setProperty('--background', bgPage)
    }
    if (textPrimary) {
      root.style.setProperty('--text', textPrimary)
    }
    if (textSecondary) {
      root.style.setProperty('--subtle', textSecondary)
    }
    if (border) {
      root.style.setProperty('--border', border)
    }
        }
        
        // Update favicon
  const updateFavicon = (parsed: ParsedAppSettings) => {
    if (typeof document === 'undefined') return

    if (parsed.faviconUrl) {
      // Process favicon URL - handle data URLs, HTTP/HTTPS URLs, and base64 strings
      let faviconHref = parsed.faviconUrl.trim()
      
      // If it's already a data URL or full HTTP/HTTPS URL, use as is
      if (faviconHref.startsWith('data:') || faviconHref.startsWith('http://') || faviconHref.startsWith('https://')) {
        // Already a valid URL, use as is
      }
      // If it's a relative path (starts with / or doesn't start with http/data), treat as relative path
      else if (faviconHref.startsWith('/') || (!faviconHref.includes('://') && !faviconHref.startsWith('data:'))) {
        // It's a relative path - if it doesn't start with /, add it
        if (!faviconHref.startsWith('/')) {
          faviconHref = '/' + faviconHref
        }
        // Convert to full URL - use API base URL but remove /graphql if present
        let baseUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin
        // Remove /graphql suffix if present (common mistake)
        baseUrl = baseUrl.replace(/\/graphql\/?$/, '')
        faviconHref = `${baseUrl.replace(/\/$/, '')}${faviconHref}`
      }
      // If it's base64 without data URL prefix, add it
      else if (faviconHref.startsWith('iVBORw0KGgo') || faviconHref.startsWith('/9j/')) {
        const imageType = faviconHref.startsWith('iVBORw0KGgo') ? 'png' : 'jpeg'
        faviconHref = `data:image/${imageType};base64,${faviconHref}`
      }
      // Default: treat as base64 PNG
      else {
        faviconHref = `data:image/png;base64,${faviconHref}`
      }
      
      // Update or create favicon link
      let favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement
      if (!favicon) {
        favicon = document.createElement('link')
        favicon.rel = 'icon'
        document.head.appendChild(favicon)
      }
      favicon.href = faviconHref
    } else {
      // Keep the bundled NOVA favicon when a tenant has not configured one.
      let favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement
      if (!favicon) {
        favicon = document.createElement('link')
        favicon.rel = 'icon'
        document.head.appendChild(favicon)
      }
      favicon.href = DEFAULT_FAVICON_PATH
    }
  }
        
  // Update SEO metadata (Professional implementation)
  const updateSEOMetadata = (parsed: ParsedAppSettings) => {
    if (typeof document === 'undefined') return

    const title = parsed.seoTitle || parsed.appName || ''
    const description = parsed.seoDescription || `Welcome to ${parsed.appName || 'our platform'}`
    const siteUrl = parsed.primaryDomain ? `https://${parsed.primaryDomain}` : window.location.origin
    const imageUrl = parsed.ogImageUrl || parsed.logoUrl || `${siteUrl}/logo.png`

    // Update document title
    document.title = title

    // Helper to update or create meta tag
    const updateMetaTag = (selector: string, attribute: string, attrValue: string, content: string) => {
      let tag = document.querySelector(selector)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attribute, attrValue)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }

    // Basic SEO meta tags
    updateMetaTag('meta[name="description"]', 'name', 'description', description)
    updateMetaTag('meta[name="keywords"]', 'name', 'keywords', parsed.seoTitle || 'betting, sports, casino, games')
    updateMetaTag('meta[name="author"]', 'name', 'author', parsed.appName || '')

    // Open Graph (Facebook, LinkedIn, etc.)
    updateMetaTag('meta[property="og:title"]', 'property', 'og:title', title)
    updateMetaTag('meta[property="og:description"]', 'property', 'og:description', description)
    updateMetaTag('meta[property="og:image"]', 'property', 'og:image', imageUrl)
    updateMetaTag('meta[property="og:url"]', 'property', 'og:url', window.location.href)
    updateMetaTag('meta[property="og:type"]', 'property', 'og:type', 'website')
    updateMetaTag('meta[property="og:site_name"]', 'property', 'og:site_name', parsed.appName || '')
    updateMetaTag('meta[property="og:locale"]', 'property', 'og:locale', parsed.defaultLocale || 'en_US')

    // Twitter Card
    updateMetaTag('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
    updateMetaTag('meta[name="twitter:title"]', 'name', 'twitter:title', title)
    updateMetaTag('meta[name="twitter:description"]', 'name', 'twitter:description', description)
    updateMetaTag('meta[name="twitter:image"]', 'name', 'twitter:image', imageUrl)
    
    // Twitter handle if provided in social links
    if (parsed.socialLinks?.twitter) {
      const twitterHandle = parsed.socialLinks.twitter.split('/').pop()?.replace('@', '')
      if (twitterHandle) {
        updateMetaTag('meta[name="twitter:site"]', 'name', 'twitter:site', `@${twitterHandle}`)
        updateMetaTag('meta[name="twitter:creator"]', 'name', 'twitter:creator', `@${twitterHandle}`)
      }
    }

    // Additional SEO tags
    updateMetaTag('meta[name="robots"]', 'name', 'robots', 'index, follow')
    updateMetaTag('meta[name="viewport"]', 'name', 'viewport', 'width=device-width, initial-scale=1.0')
    updateMetaTag('meta[http-equiv="X-UA-Compatible"]', 'http-equiv', 'X-UA-Compatible', 'IE=edge')

    // Canonical URL
    let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement
    if (!canonicalLink) {
      canonicalLink = document.createElement('link')
      canonicalLink.rel = 'canonical'
      document.head.appendChild(canonicalLink)
      }
    canonicalLink.href = window.location.href

    // Add structured data (JSON-LD) for better SEO
    addStructuredData(parsed, siteUrl, title, description, imageUrl)
    }

  // Add structured data (JSON-LD schema.org markup)
  const addStructuredData = (
    parsed: ParsedAppSettings, 
    siteUrl: string, 
    _title: string, 
    description: string, 
    imageUrl: string
  ) => {
    if (typeof document === 'undefined') return

    // Remove existing structured data
    const existingScript = document.querySelector('script[type="application/ld+json"][data-schema="organization"]')
    if (existingScript) {
      existingScript.remove()
    }

    // Create Organization schema
    const organizationSchema = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: parsed.appName || '',
      url: siteUrl,
      logo: parsed.logoUrl || imageUrl,
      description: description,
      contactPoint: parsed.supportEmail || parsed.supportPhone ? {
        '@type': 'ContactPoint',
        email: parsed.supportEmail,
        telephone: parsed.supportPhone,
        contactType: 'customer support',
      } : undefined,
      sameAs: parsed.socialLinks ? Object.values(parsed.socialLinks).filter(Boolean) : [],
    }

    // Add schema to page
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute('data-schema', 'organization')
    script.textContent = JSON.stringify(organizationSchema, null, 2)
    document.head.appendChild(script)
  }

  // Initialize analytics scripts
  const initializeAnalytics = (parsed: ParsedAppSettings) => {
    if (!parsed.analytics || typeof window === 'undefined') return

    // Google Tag Manager
    if (parsed.analytics.gtmId && !document.querySelector(`script[data-gtm-id="${parsed.analytics.gtmId}"]`)) {
      const gtmScript = document.createElement('script')
      gtmScript.setAttribute('data-gtm-id', parsed.analytics.gtmId)
      gtmScript.innerHTML = `
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${parsed.analytics.gtmId}');
      `
      document.head.appendChild(gtmScript)
    }

    // Google Analytics 4
    if (parsed.analytics.ga4Id && !document.querySelector(`script[data-ga4-id="${parsed.analytics.ga4Id}"]`)) {
      const ga4Script1 = document.createElement('script')
      ga4Script1.setAttribute('data-ga4-id', parsed.analytics.ga4Id)
      ga4Script1.async = true
      ga4Script1.src = `https://www.googletagmanager.com/gtag/js?id=${parsed.analytics.ga4Id}`
      document.head.appendChild(ga4Script1)

      const ga4Script2 = document.createElement('script')
      ga4Script2.setAttribute('data-ga4-config', parsed.analytics.ga4Id)
      ga4Script2.innerHTML = `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${parsed.analytics.ga4Id}');
      `
      document.head.appendChild(ga4Script2)
    }

    // Meta Pixel
    if (parsed.analytics.metaPixelId && !document.querySelector(`script[data-meta-pixel-id="${parsed.analytics.metaPixelId}"]`)) {
      const metaPixelScript = document.createElement('script')
      metaPixelScript.setAttribute('data-meta-pixel-id', parsed.analytics.metaPixelId)
      metaPixelScript.innerHTML = `
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window, document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${parsed.analytics.metaPixelId}');
        fbq('track', 'PageView');
      `
      document.head.appendChild(metaPixelScript)
    }
  }

  const fetchSettings = useCallback(async (useCache: boolean = true): Promise<void> => {
    try {
      setError(null)

      // Try cache first if enabled
      if (useCache) {
        const cached = getCachedSettings(ownerKey)
        if (cached) {
          setParsedSettings(cached)
          updateSEOMetadata(cached)
          applyTheme(cached)
          updateFavicon(cached)
          initializeAnalytics(cached)
          setLastRefreshTime(Date.now())
          return
        }
      }

      // Fetch from API with retry
      const response = await retryWithBackoff(() => getAppSettings())
      if (owner.current !== ownerKey) return
      settingsRevision.current = { owner: ownerKey, version: response.version }
      retryCountRef.current = 0

      if (response?.data && Array.isArray(response.data)) {
        setAllAppSettings(response.data)
        const parsed = parseSettingsArray(response.data)

        setParsedSettings(parsed)
        setCachedSettings(parsed, ownerKey)
        setLastRefreshTime(Date.now())

        // Update legacy format (for backward compatibility)
        const legacySettings: AppSettings = {
          siteTitle: parsed.seoTitle || parsed.appName || '',
          logoImg: parsed.logoUrl || null, // Use whitelabel logoUrl
          color: parsed.whitelabelTheme?.primary || undefined, // Use theme primary color
          faviconImg: parsed.faviconUrl || null, // Use whitelabel faviconUrl
        }
        setAppSettings(legacySettings)

        // Update SEO, theme, favicon, and analytics
        updateSEOMetadata(parsed)
        applyTheme(parsed)
        updateFavicon(parsed)
        initializeAnalytics(parsed)
        
        // Update PWA manifest
        if (typeof window !== 'undefined') {
          import('./pwa').then(({ updatePWAManifest }) => {
            updatePWAManifest(parsed)
          })
        }
      } else {
        // Fallback to defaults
        if (process.env.NODE_ENV === 'development') {
          console.warn('[AppSettings] Response data not array, using defaults:', {
            hasResponse: !!response,
            hasData: !!response?.data,
            dataType: typeof response?.data,
          })
        }
        const fallback = getDefaultSettings()
        setParsedSettings(fallback)
        setLastRefreshTime(Date.now())
      }
    } catch (err) {
      if (owner.current !== ownerKey) return
      retryCountRef.current++
      const error = err instanceof Error ? err : new Error('Failed to fetch app settings')
      setError(error)
      
      // Debug logging for errors
      if (process.env.NODE_ENV === 'development') {
        console.error('[AppSettings] Fetch error:', err)
      }

      // Try cache as fallback
      const cached = getCachedSettings(ownerKey)
      if (cached) {
        setParsedSettings(cached)
        updateSEOMetadata(cached)
        applyTheme(cached)
        updateFavicon(cached)
        setLastRefreshTime(Date.now())
      } else {
        const fallback = getDefaultSettings()
        setParsedSettings(fallback)
        updateSEOMetadata(fallback)
        applyTheme(fallback)
        updateFavicon(fallback)
        setLastRefreshTime(Date.now())
      }

      // Show error toast (only after all retries failed)
      if (retryCountRef.current >= MAX_RETRY_ATTEMPTS) {
        toast.error('Failed to load app settings', {
          description: 'Using cached or default settings. Please refresh the page.',
          action: {
            label: 'Retry',
            onClick: () => refreshAppSettings(false),
          },
        })
      }
    }
  // The owner guard also prevents an old account's settings from winning a late response.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  const refreshAppSettings = useCallback(async (useCache = true): Promise<void> => {
    if (settingsInFlight.current?.owner === ownerKey) return settingsInFlight.current.promise
    const promise = fetchSettings(useCache)
    settingsInFlight.current = { owner: ownerKey, promise }
    try { await promise }
    finally { if (settingsInFlight.current?.promise === promise) settingsInFlight.current = null }
  }, [fetchSettings, ownerKey])

  const checkSettingsVersion = useCallback(async () => {
    if (settingsInFlight.current?.owner === ownerKey || revisionInFlight.current) return
    const marker = {}
    revisionInFlight.current = marker
    try {
      const version = await getAppSettingsVersion()
      if (owner.current !== ownerKey) return
      if (settingsRevision.current.owner !== ownerKey || settingsRevision.current.version !== version) await refreshAppSettings(false)
    } catch {
      if (owner.current === ownerKey) await refreshAppSettings(false)
    } finally { if (revisionInFlight.current === marker) revisionInFlight.current = null }
  }, [ownerKey, refreshAppSettings])

  const refreshAdvertisements = async () => {
    const request = ++adsGeneration.current
    try {
      const response = await getAdvertisements()
      if (owner.current !== ownerKey || adsGeneration.current !== request) return
      
      if (response?.data && Array.isArray(response.data) && response.data.length > 0) {
        const sortedAds = response.data.sort((a, b) => (a.order || 0) - (b.order || 0))
        setAdvertisements(sortedAds)
      } else {
        setAdvertisements([])
      }
    } catch (_e) {
      if (owner.current === ownerKey && adsGeneration.current === request) setAdvertisements([])
    }
  }

  const initializeApp = async () => {
    setIsLoading(true)
    const requestOwner = ownerKey
    // Advertising is noncritical; cached/fresh feature and maintenance settings
    // control when the shell is ready. Ads can arrive independently afterwards.
    void refreshAdvertisements()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, 12_000) })
      await Promise.race([refreshAppSettings(false), timeout])
    } finally {
      if (timer) clearTimeout(timer)
      if (owner.current === requestOwner) { setLoadedOwner(requestOwner); setIsLoading(false) }
    }
  }

  // Polling effect - only when tab is visible
  useEffect(() => {
    const startPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }

      pollingIntervalRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void checkSettingsVersion()
        }
      }, POLLING_INTERVAL)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Refresh immediately when tab becomes visible
        void checkSettingsVersion()
        startPolling()
      } else {
        // Stop polling when tab is hidden
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [checkSettingsVersion])

  // Initial load
  useEffect(() => {
    void initializeApp()
    // Reinitialize effective settings when the authenticated owner changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  // Listen for theme mode changes and re-apply whitelabel theme
  useEffect(() => {
    const handleThemeModeChange = () => {
      // Re-apply theme when mode changes
      if (parsedSettings?.whitelabelTheme) {
        applyTheme(parsedSettings)
      }
    }

    // Listen for localStorage changes (when user switches theme mode)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'stakex_theme_mode') {
        handleThemeModeChange()
      }
    }

    // Listen for class changes on documentElement (when theme.ts sets dark/light classes)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target as HTMLElement
          if (target.classList.contains('dark') || target.classList.contains('light')) {
            handleThemeModeChange()
          }
        }
      })
    })

    // Start observing
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    // Listen for storage events
    window.addEventListener('storage', handleStorageChange)

    // Also listen for custom events (if theme.ts dispatches them)
    window.addEventListener('theme-mode-change', handleThemeModeChange)

    return () => {
      observer.disconnect()
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('theme-mode-change', handleThemeModeChange)
    }
  }, [parsedSettings])

  return (
    <AppSettingsContext.Provider
      value={{
        appSettings,
        parsedSettings,
        allAppSettings,
        advertisements,
        isLoading: isLoading || loadedOwner !== ownerKey,
        error,
        lastRefreshTime,
        refreshAppSettings,
        refreshAdvertisements,
        clearCache,
      }}
    >
      {children}
    </AppSettingsContext.Provider>
  )
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext)
  if (context === undefined) {
    throw new Error('useAppSettings must be used within an AppSettingsProvider')
  }
  return context
}

// Export cache helpers for dev tools
export { clearCache, getCachedSettings, setCachedSettings }
/* eslint-enable react-refresh/only-export-components */
