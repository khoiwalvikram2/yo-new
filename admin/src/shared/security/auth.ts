import { gql } from '@apollo/client'
import { useAuthStore } from '../core/authStore'
import { keepSignOutReasonForReload, rememberSignOutReason, type SignOutReason } from '../core/signOutReason'
import { localStorageService } from '../services/storage'
import { messageService } from '../services/notification'

export const LOGOUT_MUTATION = gql`
  mutation Logout {
    logout {
      success
      message
    }
  }
`

// Security constants
const TOKEN_REFRESH_THRESHOLD = 5 * 60 * 1000 // 5 minutes before expiry
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes

// Token management
export const tokenService = {
  // Get token from storage
  getToken: (): string | null => {
    const authData = localStorageService.get('auth-storage')
    return authData?.state?.token || null
  },

  // Set token in storage
  setToken: (token: string): void => {
    const authData = localStorageService.get('auth-storage') || { state: {} }
    authData.state.token = token
    localStorageService.set('auth-storage', authData)
  },

  // Remove token from storage
  removeToken: (): void => {
    const authData = localStorageService.get('auth-storage') || { state: {} }
    delete authData.state.token
    localStorageService.set('auth-storage', authData)
  },

  // Check if token is expired
  isTokenExpired: (token: string): boolean => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      const currentTime = Date.now() / 1000
      return payload.exp < currentTime
    } catch {
      return true
    }
  },

  // Get token expiry time
  getTokenExpiry: (token: string): number | null => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.exp * 1000 // Convert to milliseconds
    } catch {
      return null
    }
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
    try {
      return JSON.parse(atob(token.split('.')[1]))
    } catch {
      return null
    }
  },
}

// Guard: only one redirect to login when token expires (avoids multiple handleSessionTimeout calls)
let sessionRedirectScheduled = false

// Authentication security
export const authSecurity = {
  // Validate login credentials
  validateCredentials: (email: string, password: string): { isValid: boolean; errors: string[] } => {
    const errors: string[] = []

    // Email validation
    if (!email || !email.trim()) {
      errors.push('Email is required')
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email format')
    }

    // Password validation
    if (!password || !password.trim()) {
      errors.push('Password is required')
    } else if (password.length < 8) {
      errors.push('Password must be at least 8 characters long')
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(password)) {
      errors.push('Password must contain uppercase, lowercase, number, and special character')
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  },

  // Check login attempts
  checkLoginAttempts: (email: string): { canAttempt: boolean; attemptsLeft: number } => {
    const attempts = localStorageService.get(`login-attempts-${email}`) || { count: 0, lastAttempt: 0 }
    const now = Date.now()

    // Reset attempts if lockout period has passed
    if (now - attempts.lastAttempt > LOCKOUT_DURATION) {
      attempts.count = 0
    }

    const attemptsLeft = Math.max(0, MAX_LOGIN_ATTEMPTS - attempts.count)
    const canAttempt = attempts.count < MAX_LOGIN_ATTEMPTS

    return { canAttempt, attemptsLeft }
  },

  // Record failed login attempt
  recordFailedAttempt: (email: string): void => {
    const attempts = localStorageService.get(`login-attempts-${email}`) || { count: 0, lastAttempt: 0 }
    attempts.count += 1
    attempts.lastAttempt = Date.now()
    localStorageService.set(`login-attempts-${email}`, attempts)
  },

  // Clear login attempts
  clearLoginAttempts: (email: string): void => {
    localStorageService.remove(`login-attempts-${email}`)
  },

  // Secure logout: invalidate token on server then clear local state. A forced sign-out passes its reason, which the
  // sign-in page shows after the reload below (signOutReason.ts); a sign-out on purpose passes none.
  secureLogout: async (reason?: SignOutReason): Promise<void> => {
    try {
      const { apolloClient } = await import('../core/api')
      await apolloClient.mutate({ mutation: LOGOUT_MUTATION })
    } catch {
      // Ignore errors (e.g. network); still clear local state
    }
    const authStore = useAuthStore.getState()
    authStore.logout()
    tokenService.removeToken()
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.clear()
      }
    } catch {}
    // B009: after the clear (which would wipe it) and before the reload (which drops every toast). The route guard
    // shows this document's own sign-in page before the reload lands; it leaves the reason for the reloaded one.
    if (reason) {
      rememberSignOutReason(reason)
      keepSignOutReasonForReload()
    }
    messageService.info('Logged out successfully')
    try {
      if (typeof window !== 'undefined') {
        window.location.replace('/login')
      }
    } catch {}
  },

  // Session timeout handler — redirect to login once (guard avoids multiple redirects when many requests hit with expired token)
  handleSessionTimeout: (): void => {
    if (sessionRedirectScheduled) return
    sessionRedirectScheduled = true
    messageService.warning('Your session has expired. Please log in again.')
    authSecurity.secureLogout('session-expired')
  },

  // Check session validity
  checkSessionValidity: (): boolean => {
    const token = tokenService.getToken()
    if (!token) return false

    if (tokenService.isTokenExpired(token)) {
      authSecurity.handleSessionTimeout()
      return false
    }

    return true
  },
}

// Permission security
export const permissionSecurity = {
  // Check if user has permission
  hasPermission: (permission: string, userPermissions?: string[]): boolean => {
    if (!userPermissions) return false
    
    // Check for wildcard permission
    if (userPermissions.includes('*') || userPermissions.includes('admin:*')) {
      return true
    }

    // Check for exact permission
    if (userPermissions.includes(permission)) {
      return true
    }

    // Check for domain wildcard (e.g., 'sports:*' for 'sports:view')
    const [domain] = permission.split(':')
    if (userPermissions.includes(`${domain}:*`)) {
      return true
    }

    return false
  },

  // Check multiple permissions (AND logic)
  hasAllPermissions: (permissions: string[], userPermissions?: string[]): boolean => {
    return permissions.every(permission => 
      permissionSecurity.hasPermission(permission, userPermissions)
    )
  },

  // Check multiple permissions (OR logic)
  hasAnyPermission: (permissions: string[], userPermissions?: string[]): boolean => {
    return permissions.some(permission => 
      permissionSecurity.hasPermission(permission, userPermissions)
    )
  },

  // Get user role level
  getRoleLevel: (role: string): number => {
    const roleLevels: Record<string, number> = {
      'super_admin': 100,
      'admin': 80,
      'manager': 60,
      'operator': 40,
      'viewer': 20,
    }
    return roleLevels[role] || 0
  },

  // Check if user can access resource
  canAccessResource: (resource: string, action: string, userRole?: string): boolean => {
    if (!userRole) return false

    const roleLevel = permissionSecurity.getRoleLevel(userRole)
    
    // Super admin can access everything
    if (roleLevel >= 100) return true

    // Define resource access levels
    const resourceLevels: Record<string, number> = {
      'users:manage': 80,
      'system:config': 80,
      'audit:view': 60,
      'reports:export': 60,
      'players:manage': 40,
      'sports:manage': 40,
      'casino:manage': 40,
    }

    const requiredLevel = resourceLevels[`${resource}:${action}`] || 20
    return roleLevel >= requiredLevel
  },
}

// Security headers
export const securityHeaders = {
  // Get security headers for API requests
  getSecurityHeaders: (): Record<string, string> => {
    const token = tokenService.getToken()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Client-Version': '1.0.0',
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    // Add CSRF token if available
    const csrfToken = localStorageService.get('csrf-token')
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken
    }

    return headers
  },

  // Validate security headers in response
  validateResponseHeaders: (headers: Headers): boolean => {
    // Check for security headers
    const requiredHeaders = [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'X-XSS-Protection',
    ]

    return requiredHeaders.every(header => headers.has(header))
  },
}

// Security middleware
export const securityMiddleware = {
  // Intercept API requests
  interceptRequest: (config: any): any => {
    // Add security headers
    const headersToAdd = securityHeaders.getSecurityHeaders()
    config.headers = { ...config.headers, ...headersToAdd }

    // Validate session before request
    if (!authSecurity.checkSessionValidity()) {
      throw new Error('Session expired')
    }

    return config
  },

  // Intercept API responses
  interceptResponse: (response: any): any => {
    // Check for security violations
    if (response.status === 401) {
      authSecurity.handleSessionTimeout()
      throw new Error('Unauthorized')
    }

    if (response.status === 403) {
      messageService.error('Access denied. Insufficient permissions.')
      throw new Error('Forbidden')
    }

    // Validate response headers
    if (response.headers && !securityHeaders.validateResponseHeaders(response.headers)) {
    }

    return response
  },

  // Handle security errors
  handleSecurityError: (error: any): void => {
    if (error.message === 'Session expired') {
      authSecurity.handleSessionTimeout()
    } else if (error.message === 'Unauthorized') {
      messageService.error('Authentication required')
    } else if (error.message === 'Forbidden') {
      messageService.error('Access denied')
    } else {
      messageService.error('Security error occurred')
    }
  },
}
