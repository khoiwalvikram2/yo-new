import { useAppSettings as useAppSettingsContext, type ParsedAppSettings, type AppFeatures, type PaymentsConfig, type RiskConfig } from '../lib/app-settings'

export function useAppSettings() {
  return useAppSettingsContext()
}

/**
 * Hook to access parsed app settings with full type safety
 */
export function useParsedSettings(): ParsedAppSettings {
  const { parsedSettings } = useAppSettingsContext()
  return parsedSettings
}

/**
 * Hook to check if a feature is enabled
 */
export function useFeatureFlags() {
  const { parsedSettings, isLoading } = useAppSettingsContext()
  // Do not flash another account's or anonymous cached product menus during hydration.
  if (isLoading) return { ...parsedSettings.features, sportsEnabled: false, casinoEnabled: false, matkaEnabled: false }
  return parsedSettings.features
}

/**
 * Hook to check if a specific feature is enabled
 */
export function useFeatureEnabled(feature: keyof AppFeatures): boolean {
  const features = useFeatureFlags()
  return features[feature] ?? false
}

/**
 * Hook to access payment configuration
 */
export function usePaymentConfig(): PaymentsConfig {
  const { parsedSettings } = useAppSettingsContext()
  return parsedSettings.payments
}

/**
 * Hook to access risk configuration
 */
export function useRiskConfig(): RiskConfig {
  const { parsedSettings } = useAppSettingsContext()
  return parsedSettings.risk
}

/**
 * Hook to check maintenance mode
 */
export function useMaintenanceMode(): { isMaintenance: boolean; message?: string | null } {
  const { parsedSettings } = useAppSettingsContext()
  return {
    isMaintenance: parsedSettings.maintenance,
    message: parsedSettings.maintenanceMessage,
  }
}

/**
 * Hook to get app identity information
 */
export function useAppIdentity() {
  const { parsedSettings } = useAppSettingsContext()
  return {
    appName: parsedSettings.appName,
    supportEmail: parsedSettings.supportEmail,
    supportPhone: parsedSettings.supportPhone,
    whatsappSupportPhone: parsedSettings.whatsappSupportPhone,
    baseCurrency: parsedSettings.baseCurrency,
    defaultLocale: parsedSettings.defaultLocale,
    timeZone: parsedSettings.timeZone,
  }
}

/**
 * Hook to get SEO metadata
 */
export function useSEO() {
  const { parsedSettings } = useAppSettingsContext()
  return {
    title: parsedSettings.seoTitle || parsedSettings.appName,
    description: parsedSettings.seoDescription,
    ogImageUrl: parsedSettings.ogImageUrl,
  }
}

/**
 * Hook to get social links
 */
export function useSocialLinks(): Record<string, string> | null {
  const { parsedSettings } = useAppSettingsContext()
  return parsedSettings.socialLinks || null
}

export function useLogo() {
  const { parsedSettings, appSettings } = useAppSettingsContext()
  
  // Process logo image to ensure proper data URL format
  const processLogoSrc = (logoImg: string | null | undefined) => {
    if (!logoImg) return null
    
    const logo = logoImg.trim()
    
    // If it's already a data URL, return as is
    if (logo.startsWith('data:image/')) {
      return logo
    }
    
    // If it's a full URL (http/https), return as is
    if (logo.startsWith('http://') || logo.startsWith('https://')) {
      return logo
    }
    
    // If it's a relative path (starts with / or doesn't have ://), convert to full URL
    if (logo.startsWith('/') || (!logo.includes('://') && !logo.startsWith('data:'))) {
      // It's a relative path - if it doesn't start with /, add it
      const relativePath = logo.startsWith('/') ? logo : '/' + logo
      // Convert to full URL - use API base URL but remove /graphql if present
      let baseUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin
      // Remove /graphql suffix if present (common mistake)
      baseUrl = baseUrl.replace(/\/graphql\/?$/, '')
      return `${baseUrl.replace(/\/$/, '')}${relativePath}`
    }
    
    // If it's base64 without data URL prefix, add it
    if (logo.startsWith('iVBORw0KGgo') || logo.startsWith('/9j/')) {
      // Determine image type from base64 header
      const imageType = logo.startsWith('iVBORw0KGgo') ? 'png' : 'jpeg'
      return `data:image/${imageType};base64,${logo}`
    }
    
    // Default: treat as base64 PNG
    return `data:image/png;base64,${logo}`
  }
  
  // Priority: Use parsedSettings.logoUrl (from whitelabel) > legacy appSettings.logoImg
  const logoSource = parsedSettings?.logoUrl || appSettings?.logoImg || null
  const logoSrc = processLogoSrc(logoSource)
  
  // Priority: Use parsedSettings.seoTitle > parsedSettings.appName > legacy appSettings.siteTitle.
  // App name comes from the backend only; blank stays blank (no env/hardcoded fallback).
  const siteTitle = parsedSettings?.seoTitle ||
                    parsedSettings?.appName ||
                    appSettings?.siteTitle ||
                    ''
  
  return {
    logoSrc,
    siteTitle
  }
}

export function useBanners() {
  const { advertisements, isLoading } = useAppSettingsContext()
  return {
    banners: advertisements,
    isLoading
  }
}
