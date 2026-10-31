/**
 * Token Service for User Frontend
 * Handles token expiration checking and session management
 */

// Security constants
const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000 // 5 minutes before expiry

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const decoded = JSON.parse(json)
    return decoded && typeof decoded === 'object' ? decoded as Record<string, unknown> : null
  } catch {
    return null
  }
}

// Token management
export const tokenService = {
  // Get token from storage
  getToken: (): string | null => {
    try {
      if (typeof window === 'undefined') return null
      return window.localStorage.getItem('token')
    } catch {
      return null
    }
  },

  // Check if token is expired
  isTokenExpired: (token: string): boolean => {
    const payload = decodeJwtPayload(token)
    const expiry = Number(payload?.exp)
    if (!Number.isFinite(expiry)) return true
    return expiry <= Date.now() / 1000
  },

  // Get token expiry time
  getTokenExpiry: (token: string): number | null => {
    const payload = decodeJwtPayload(token)
    const expiry = Number(payload?.exp)
    return Number.isFinite(expiry) ? expiry * 1000 : null
  },

  // Check if token needs refresh
  needsRefresh: (token: string): boolean => {
    const expiry = tokenService.getTokenExpiry(token)
    if (!expiry) return true
    
    const timeUntilExpiry = expiry - Date.now()
    return timeUntilExpiry < TOKEN_REFRESH_THRESHOLD
  },

  // Decode token payload
  decodeToken: (token: string): any => {
    return decodeJwtPayload(token)
  },

  // Check session validity
  checkSessionValidity: (): boolean => {
    const token = tokenService.getToken()
    if (!token) return false
    return !tokenService.isTokenExpired(token)
  },
}

