/**
 * Whitelabel Configuration Utility
 * 
 * Provides centralized access to whitelabel ID configuration.
 * The whitelabel ID is fully managed by the VITE_WHITELABEL_ID environment variable.
 */

/**
 * Get the current whitelabel ID
 * 
 * Priority:
 * 1. VITE_WHITELABEL_ID from .env (fully managed)
 * 2. window.location.hostname (fallback for domain-based detection)
 * 
 * @returns The whitelabel ID to use for API requests
 */
export function getWhitelabelId(): string {
  if (typeof window === 'undefined') {
    // Server-side: only use env variable
    return import.meta.env.VITE_WHITELABEL_ID || 'default'
  }

  const envWhitelabelId = import.meta.env.VITE_WHITELABEL_ID
  const hostname = window.location.hostname

  // Primary: Use env variable if set (fully managed)
  if (envWhitelabelId) {
    return envWhitelabelId
  }

  // Fallback: Use hostname for domain-based detection
  return hostname
}

/**
 * Check if whitelabel ID is managed by environment variable
 * 
 * @returns true if VITE_WHITELABEL_ID is set, false otherwise
 */
export function isWhitelabelIdFromEnv(): boolean {
  return !!import.meta.env.VITE_WHITELABEL_ID
}

/**
 * Get whitelabel configuration info (for debugging)
 */
export function getWhitelabelConfig() {
  const envId = import.meta.env.VITE_WHITELABEL_ID
  const hostname = typeof window !== 'undefined' ? window.location.hostname : null
  const currentId = getWhitelabelId()

  return {
    envWhitelabelId: envId || null,
    hostname,
    currentWhitelabelId: currentId,
    isFromEnv: isWhitelabelIdFromEnv(),
    source: envId ? 'environment' : 'domain',
  }
}

