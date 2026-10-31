import type { ParsedAppSettings } from './app-settings'

export function updatePWAManifest(settings: ParsedAppSettings) {
  if (typeof window === 'undefined' || !settings.pwa) return

  try {
    // Update manifest link if it exists
    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement
    if (!manifestLink) {
      manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      document.head.appendChild(manifestLink)
    }

    // Create manifest content
    const manifest = {
      name: settings.pwa.name || settings.appName || '',
      short_name: settings.pwa.shortName || settings.appName || '',
      description: settings.pwa.description || settings.seoDescription || '',
      start_url: settings.pwa.startUrl || '/',
      display: settings.pwa.display || 'standalone',
      background_color: settings.pwa.backgroundColor || '#ffffff',
      theme_color: settings.pwa.themeColor || settings.color || '#3b82f6',
      icons: settings.pwa.icons || [],
      orientation: settings.pwa.orientation || 'portrait',
    }

    // Create blob URL for manifest
    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
    const manifestUrl = URL.createObjectURL(manifestBlob)
    manifestLink.href = manifestUrl

    // Update theme color meta tag
    let themeColorMeta = document.querySelector('meta[name="theme-color"]')
    if (!themeColorMeta) {
      themeColorMeta = document.createElement('meta')
      themeColorMeta.setAttribute('name', 'theme-color')
      document.head.appendChild(themeColorMeta)
    }
    themeColorMeta.setAttribute('content', manifest.theme_color)

    // Update apple-mobile-web-app-capable
    let appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]')
    if (!appleCapable) {
      appleCapable = document.createElement('meta')
      appleCapable.setAttribute('name', 'apple-mobile-web-app-capable')
      document.head.appendChild(appleCapable)
    }
    appleCapable.setAttribute('content', 'yes')

    // Update apple-mobile-web-app-status-bar-style
    let appleStatusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
    if (!appleStatusBar) {
      appleStatusBar = document.createElement('meta')
      appleStatusBar.setAttribute('name', 'apple-mobile-web-app-status-bar-style')
      document.head.appendChild(appleStatusBar)
    }
    appleStatusBar.setAttribute('content', settings.pwa.statusBarStyle || 'default')

    // Update apple-mobile-web-app-title
    let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (!appleTitle) {
      appleTitle = document.createElement('meta')
      appleTitle.setAttribute('name', 'apple-mobile-web-app-title')
      document.head.appendChild(appleTitle)
    }
    appleTitle.setAttribute('content', manifest.short_name)
  } catch (_error) {
    // Failed to update manifest
  }
}

