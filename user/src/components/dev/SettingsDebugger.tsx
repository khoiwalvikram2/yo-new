import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { getWhitelabelId } from '@/lib/whitelabel'
import { ChevronDown, ChevronUp, RefreshCw, Trash2, Settings } from 'lucide-react'
import { useAppSettings, clearCache, getCachedSettings } from '@/lib/app-settings'

export default function SettingsDebugger() {
  const { parsedSettings, isLoading, error, lastRefreshTime, refreshAppSettings, clearCache: clearCacheFromContext } = useAppSettings()
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)

  const { user, isAuthenticated } = useAuth()
  const cached = getCachedSettings(`${getWhitelabelId()}:${isAuthenticated ? user?.id || 'pending' : 'anonymous'}`)
  const cacheAge = cached ? Date.now() - (cached as any).timestamp : null

  const handleClearCache = () => {
    clearCache()
    clearCacheFromContext()
    window.location.reload()
  }

  const handleForceRefresh = () => {
    refreshAppSettings()
  }

  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never'
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const formatAge = (ms: number | null) => {
    if (!ms) return 'N/A'
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`
    return `${seconds}s ago`
  }

  const sections = [
    { key: 'features', label: 'Feature Flags', data: parsedSettings.features },
    { key: 'payments', label: 'Payment Config', data: parsedSettings.payments },
    { key: 'risk', label: 'Risk Config', data: parsedSettings.risk },
    { key: 'seo', label: 'SEO & Social', data: { seoTitle: parsedSettings.seoTitle, seoDescription: parsedSettings.seoDescription, ogImageUrl: parsedSettings.ogImageUrl, socialLinks: parsedSettings.socialLinks } },
    { key: 'analytics', label: 'Analytics', data: parsedSettings.analytics },
    { key: 'domains', label: 'Domains', data: parsedSettings.domains },
    { key: 'pwa', label: 'PWA', data: parsedSettings.pwa },
    { key: 'identity', label: 'App Identity', data: { appName: parsedSettings.appName, supportEmail: parsedSettings.supportEmail, supportPhone: parsedSettings.supportPhone, baseCurrency: parsedSettings.baseCurrency } },
  ]

  // Opt in to developer chrome so local player previews match the shipped UI.
  // Checked after the hooks so hook order stays constant.
  if (!import.meta.env.DEV || import.meta.env.VITE_SETTINGS_DEBUG !== 'true') {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-md">
      <div className="bg-[color:var(--surface)] border border-[color:var(--border)] rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between p-3 bg-[color:var(--surface-2)] cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-[color:var(--brand-primary)]" />
            <span className="text-sm font-semibold text-[color:var(--text)]">Settings Debugger</span>
            {error && (
              <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400">Error</span>
            )}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-[color:var(--subtle)]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[color:var(--subtle)]" />
          )}
        </div>

        {/* Content */}
        {isExpanded && (
          <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
            {/* Status */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[color:var(--subtle)]">Status:</span>
                <span className={isLoading ? 'text-yellow-400' : 'text-emerald-400'}>
                  {isLoading ? 'Loading...' : 'Ready'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[color:var(--subtle)]">Last Refresh:</span>
                <span className="text-[color:var(--text)]">{formatTime(lastRefreshTime)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[color:var(--subtle)]">Cache Age:</span>
                <span className="text-[color:var(--text)]">{formatAge(cacheAge)}</span>
              </div>
              {error && (
                <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
                  <p className="text-red-400 text-xs">{error.message}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleForceRefresh}
                disabled={isLoading}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[color:var(--brand-primary)]/10 hover:bg-[color:var(--brand-primary)]/20 text-[color:var(--brand-primary)] text-xs font-medium transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                onClick={handleClearCache}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear Cache
              </button>
            </div>

            {/* Settings Sections */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[color:var(--text)] mb-2">Settings:</p>
              {sections.map((section) => (
                <div key={section.key} className="border border-[color:var(--border)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setSelectedSection(selectedSection === section.key ? null : section.key)}
                    className="w-full flex items-center justify-between p-2 bg-[color:var(--surface-2)] hover:bg-[color:var(--surface-3)] transition-colors"
                  >
                    <span className="text-xs font-medium text-[color:var(--text)]">{section.label}</span>
                    {selectedSection === section.key ? (
                      <ChevronUp className="h-3 w-3 text-[color:var(--subtle)]" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-[color:var(--subtle)]" />
                    )}
                  </button>
                  {selectedSection === section.key && (
                    <div className="p-2 bg-[color:var(--surface)]">
                      <pre className="text-[10px] text-[color:var(--text)] overflow-x-auto">
                        {JSON.stringify(section.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Full Settings (Collapsed) */}
            <details className="border border-[color:var(--border)] rounded-lg overflow-hidden">
              <summary className="p-2 bg-[color:var(--surface-2)] cursor-pointer text-xs font-medium text-[color:var(--text)]">
                Full Settings JSON
              </summary>
              <div className="p-2 bg-[color:var(--surface)]">
                <pre className="text-[10px] text-[color:var(--text)] overflow-x-auto max-h-48 overflow-y-auto">
                  {JSON.stringify(parsedSettings, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}

