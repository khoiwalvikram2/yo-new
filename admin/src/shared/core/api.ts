import { ApolloClient, InMemoryCache, ApolloLink, from, split } from '@apollo/client'
import Observable from 'zen-observable'
import { BatchHttpLink } from '@apollo/client/link/batch-http'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
/* Feedback raised by the links goes through the kit's toast queue (page migration C, W0). It was
   antd's notification, top-right; it is the kit's now, bottom-centre, with failures announced
   assertively. The wording and the timings are unchanged. */
import { toast } from '@/ui/components/toast'
import { getMainDefinition } from '@apollo/client/utilities'
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'
import { createClient } from 'graphql-ws'
import { tokenService, authSecurity } from '@/shared/security/auth'
import { localStorageService } from '@/shared/services/storage'
import { useUIStore } from '@/shared/core/uiStore'
import { useAuthStore } from '@/shared/core/authStore'

// Endpoints
const HTTP_URI = import.meta.env.VITE_GRAPHQL_ENDPOINT || 'http://localhost:4000/graphql'
const WS_URI = import.meta.env.VITE_GRAPHQL_WS_ENDPOINT
  || (HTTP_URI.startsWith('http') ? HTTP_URI.replace(/^http/, 'ws') : 'ws://localhost:4000/graphql')

// HTTP Link - use batching to coalesce multiple operations into fewer requests (reduces request flood on load)
const httpLink = new BatchHttpLink({
  uri: HTTP_URI,
  batchMax: 15,
  batchInterval: 20,
})

// Auth Link - CRITICAL: Read from store first so agent login works before persist writes to localStorage
const authLink = setContext((_, { headers }) => {
  const storeState = useAuthStore.getState()
  let token = storeState.token
  let agent = storeState.agent
  let roles = storeState.roles || []
  if (!token && typeof window !== 'undefined') {
    const stored = localStorage.getItem('auth-storage')
    const parsed = stored ? JSON.parse(stored) : null
    token = parsed?.state?.token
    agent = agent ?? parsed?.state?.agent
    roles = roles.length ? roles : (parsed?.state?.roles || [])
  }
  // CRITICAL: Use UI store instead of direct localStorage access for consistency
  const directorMode = useUIStore.getState().directorMode
  const selectedWhitelabelId = useUIStore.getState().selectedWhitelabelId
  const authHeaders: Record<string, string> = {}
  
  if (token) {
    authHeaders.authorization = `Bearer ${token}`
  }
  
  try {
    // CRITICAL: Check if user is Super Admin
    const isSuperAdmin = roles.some((r: string) =>
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    // CRITICAL: Check if user is Whitelabel Admin (only after login)
    const isWhitelabelAdmin = roles.some((r: string) =>
      r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
    )
    
    // Super Admin mode handling
    if (isSuperAdmin) {
      // Send Super Admin mode header
      authHeaders['X-Admin-Mode'] = directorMode
      
      if (directorMode === 'whitelabel' && selectedWhitelabelId) {
        // Whitelabel mode: send selected whitelabel ID
        authHeaders['X-Whitelabel-ID'] = selectedWhitelabelId
        authHeaders['X-Whitelabel'] = selectedWhitelabelId
      }
      // Core mode: don't send X-Whitelabel-ID (backend will skip tenant filtering)
    } else {
      // CRITICAL: Whitelabel Admin and Agents use existing logic (UNCHANGED)
      // Always send whitelabel ID header if available (needed for login before auth state is set)
      // Check localStorage for tenant (which is the whitelabel ID) or X_WHITELABEL_ID
      const tenantFromStorage = (typeof window !== 'undefined' ? window.localStorage.getItem('TENANT') : null)
      const whitelabelIdFromStorage = (typeof window !== 'undefined' ? window.localStorage.getItem('X_WHITELABEL_ID') : null)
      const whitelabelId = whitelabelIdFromStorage || tenantFromStorage
      
      if (whitelabelId && whitelabelId !== 'default') {
        authHeaders['X-Whitelabel-ID'] = whitelabelId
        // Also send as x-whitelabel for backward compatibility
        authHeaders['X-Whitelabel'] = whitelabelId
      } else {
        // Fallback to legacy X-Whitelabel header (domain-based)
        const wl = (typeof window !== 'undefined' ? window.localStorage.getItem('X_WHITELABEL') : null) || (import.meta as any).env?.VITE_WHITELABEL_HOST
        if (wl) authHeaders['X-Whitelabel'] = wl
      }
      
      // SECURITY: Whitelabel Admins cannot switch tenants - backend derives tenant from Host header
      // For Whitelabel Admins, NEVER send X-Tenant header (backend will reject it anyway)
      if (!isWhitelabelAdmin) {
        // For agents, use agent.tenantId; otherwise use localStorage
        const tenant = agent?.tenantId || tenantFromStorage
        if (tenant) authHeaders['X-Tenant'] = tenant
      }
      // For Whitelabel Admins, tenant is derived from Host header on backend - don't send X-Tenant
    }
  } catch {}
  
  return {
    headers: {
      ...headers,
      ...authHeaders,
    },
  }
})

// Error Link - show backend error messages via AntD notification
// CRITICAL: Always return forward(operation) so the link chain completes and requests don't hang/loop
const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  // Skip error link notifications for mutations - let them handle errors in catch blocks
  // This prevents duplicate error messages
  const definition = getMainDefinition(operation.query)
  const isMutation = (definition as any)?.operation === 'mutation'

  /** Many resolvers throw `Unauthorized: You can only…` for scope (user is logged in, wrong resource).
   *  Treating every "unauthorized" as session death logs agents out when search/nav hits a guarded query.
   *  Only force-logout on missing/invalid session signals.
   *  NOTE: "suspended" is intentionally excluded — it appears in login-rejection messages like
   *  "Agent account is suspended" which must NOT kill the currently logged-in admin's session. */
  const isSessionEndingAuthError = (msg: string) => {
    const m = msg.toLowerCase()
    if (/\byou can only\b/.test(m)) return false
    if (/only commission agents can/.test(m)) return false
    if (/only admins can/.test(m)) return false
    if (/agents cannot/.test(m)) return false
    if (/does not belong to your tenant/.test(m)) return false
    if (/agent does not belong/.test(m)) return false
    if (/bonus belongs to another tenant/.test(m)) return false
    if (/agent login or agentid required/i.test(m)) return false
    if (/account is suspended|account is blocked|account is not active/i.test(m)) return false

    return (
      /\bunauthenticated\b/.test(m) ||
      /token invalid|session invalid|token expired/.test(m) ||
      /unauthorized:\s*authentication required/i.test(msg) ||
      /unauthorized:\s*not authenticated/i.test(msg) ||
      /user not authenticated/i.test(m)
    )
  }
  const isPermissionError = (msg: string) =>
    /insufficient permissions|permission denied|not allowed|forbidden.*permissions/i.test(msg)

  // Never force-logout on login operations — auth failures there are expected (wrong password, suspended, etc.)
  const opName = operation.operationName || ''
  const isLoginOp = /agentLogin|^Login$/i.test(opName)

  if (graphQLErrors) {
    const authErrors = graphQLErrors.filter(
      (e) => !isLoginOp && isSessionEndingAuthError(e.message) && !isPermissionError(e.message)
    )
    const shouldForceLogout = authErrors.length > 0

    if (shouldForceLogout) {
      useAuthStore.getState().logout()
      toast({ title: 'Session ended', message: 'Please log in again.', tone: 'error', duration: 5000 })
      if (typeof window !== 'undefined') window.location.href = '/login'
    }
    graphQLErrors.forEach(({ message: errorMessage, locations: _locations, path: _path }) => {
      // Login ops handle their own errors (toast shown by LoginPage onError handler)
      if (isLoginOp) return
      if (!shouldForceLogout && !isMutation) {
        // Don't show toast for permission-denied on queries (e.g. background badge polling, nav)
        const isPermissionDenied = isPermissionError(errorMessage)
        if (isPermissionDenied) {
          // Silently ignore - user didn't request the action; avoids noise for support admins
          return
        }
        toast({ message: errorMessage, tone: 'error', duration: 4000 })
      }
    })
  }

  if (networkError) {
    if (!isMutation) {
      toast({
        message: (networkError as any)?.message || 'Network error occurred',
        tone: 'error',
        duration: 4000,
      })
    }
  }

  return forward(operation)
})

// Helper function to recursively find payload with success and message
function findPayloadWithSuccess(obj: any, maxDepth = 5, currentDepth = 0): any {
  if (currentDepth >= maxDepth || !obj || typeof obj !== 'object') {
    return null
  }
  
  // Check if this object has success and message
  if (
    Object.prototype.hasOwnProperty.call(obj, 'success') &&
    Object.prototype.hasOwnProperty.call(obj, 'message')
  ) {
    return obj
  }
  
  // Recursively search in all object values
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const result = findPayloadWithSuccess(obj[key], maxDepth, currentDepth + 1)
      if (result) {
        return result
      }
    }
  }
  
  return null
}

// Notification Link - surface backend messages for mutations globally
const notificationLink = new ApolloLink((operation, forward) => {
  const definition = getMainDefinition(operation.query)
  const isMutation = (definition as any)?.operation === 'mutation'

  return forward(operation)!.map((response) => {
    if (isMutation && response && response.data) {
      try {
        const context = operation.getContext()
        // Skip notifications if explicitly disabled
        if (context?.skipNotification === true) {
          return response
        }
        const ctxToast = context?.uiToast as 'message' | 'notification' | undefined
        const opName = operation.operationName || ''
        // CRITICAL: Skip notification for UpdateAdminPreferences (silent operation)
        if (opName === 'UpdateAdminPreferences') {
          return response
        }
        const defaultUseMessage = /update|upsert|delete|remove|set/i.test(opName)
        const useMessage = ctxToast ? ctxToast === 'message' : defaultUseMessage
        
        // Recursively search for payload with success and message
        const payload = findPayloadWithSuccess(response.data)
        if (payload) {
          const desc = String(payload.message || '')
          /* Both shapes the old code had are kept: a bare line for an update-like mutation, a
             titled block for everything else. The antd fallback path went with antd — there is one
             queue now, and it cannot throw. */
          if (useMessage) {
            toast({ message: desc, tone: payload.success ? 'ok' : 'error' })
          } else {
            toast({
              title: payload.success ? 'Success' : 'Error',
              message: desc,
              tone: payload.success ? 'ok' : 'error',
              duration: 4500,
            })
          }
        }
      } catch (error) {
        // Log error for debugging but don't break the response
      }
    }
    return response
  })
})

// Session Guard Link - block requests when token expired; redirect to login once (avoids server flood + hang)
const sessionGuardLink = new ApolloLink((operation, forward) => {
  const token = tokenService.getToken()
  if (token && tokenService.isTokenExpired(token)) {
    authSecurity.handleSessionTimeout()
    // Do NOT forward: return error observable so no request hits server; user is redirected to login
    return new Observable<never>((observer: import('zen-observable').SubscriptionObserver<never>) => {
      observer.error(new Error('Session expired'))
    }) as ReturnType<typeof forward>
  }
  return forward(operation)
})

// Apollo Client
// WebSocket Link for subscriptions (auth via connectionParams)
const wsLink = new GraphQLWsLink(createClient({
  url: WS_URI,
  connectionParams: async () => {
    const token = tokenService.getToken()
    const authData = localStorageService.get('auth-storage')
    const agent = authData?.state?.agent
    const roles = authData?.state?.roles || []
    const headers: Record<string, string> = {}
    
    if (token) {
      headers.authorization = `Bearer ${token}`
    }
    
    try {
      // CRITICAL: Check if user is Super Admin
    const isSuperAdmin = roles.some((r: string) =>
      r === 'Super Admin' || r.toLowerCase() === 'super_admin' || 
      (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    
    // CRITICAL: Check if user is Whitelabel Admin (only after login)
    const isWhitelabelAdmin = roles.some((r: string) =>
      r === 'Whitelabel Admin' || r.toLowerCase() === 'whitelabel_admin' || r.toLowerCase().includes('whitelabel')
    )
      
      // Super Admin mode handling
      if (isSuperAdmin) {
        // CRITICAL: Use UI store instead of direct localStorage access for consistency
        const directorMode = useUIStore.getState().directorMode
        const selectedWhitelabelId = useUIStore.getState().selectedWhitelabelId
        
        // Send Super Admin mode header
        headers['X-Admin-Mode'] = directorMode
        
        if (directorMode === 'whitelabel' && selectedWhitelabelId) {
          // Whitelabel mode: send selected whitelabel ID
          headers['X-Whitelabel-ID'] = selectedWhitelabelId
          headers['X-Whitelabel'] = selectedWhitelabelId
        }
        // Core mode: don't send X-Whitelabel-ID (backend will skip tenant filtering)
      } else {
        // CRITICAL: Whitelabel Admin and Agents use existing logic (UNCHANGED)
        // Always send whitelabel ID header if available (needed for login before auth state is set)
        const tenantFromStorage = (typeof window !== 'undefined' ? window.localStorage.getItem('TENANT') : null)
        const whitelabelIdFromStorage = (typeof window !== 'undefined' ? window.localStorage.getItem('X_WHITELABEL_ID') : null)
        const whitelabelId = whitelabelIdFromStorage || tenantFromStorage
        
        if (whitelabelId && whitelabelId !== 'default') {
          headers['X-Whitelabel-ID'] = whitelabelId
          // Also send as x-whitelabel for backward compatibility
          headers['X-Whitelabel'] = whitelabelId
        } else {
          // Fallback to legacy X-Whitelabel header (domain-based)
          const wl = (typeof window !== 'undefined' ? window.localStorage.getItem('X_WHITELABEL') : null) || (import.meta as any).env?.VITE_WHITELABEL_HOST
          if (wl) headers['X-Whitelabel'] = wl
        }
        
        // SECURITY: Whitelabel Admins cannot switch tenants - backend derives tenant from Host header
        // For Whitelabel Admins, NEVER send X-Tenant header (backend will reject it anyway)
        if (!isWhitelabelAdmin) {
          // For agents, use agent.tenantId; otherwise use localStorage
          const tenant = agent?.tenantId || tenantFromStorage
          if (tenant) headers['X-Tenant'] = tenant
        }
        // For Whitelabel Admins, tenant is derived from Host header on backend - don't send X-Tenant
      }
    } catch {}
    
    return { headers }
  },
}))

// Split link: route subscriptions to ws, others to http
const splitLink = split(
  ({ query }) => {
    const def = getMainDefinition(query)
    return def.kind === 'OperationDefinition' && (def as any).operation === 'subscription'
  },
  wsLink,
  httpLink,
)

export const apolloClient = new ApolloClient({
  link: from([sessionGuardLink, errorLink, authLink, notificationLink, splitLink]),
  cache: new InMemoryCache({
    typePolicies: {
      Query: {
        fields: {
          // Add field policies for caching
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      errorPolicy: 'all',
    },
    query: {
      errorPolicy: 'all',
    },
  },
})

// API Response Types
export interface ApiResponse<T = any> {
  data: T
  success: boolean
  message?: string
  errors?: string[]
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// API Error Types
export interface ApiError {
  message: string
  code: string
  details?: any
}

// GraphQL Error Handler
export const handleGraphQLError = (error: any): ApiError => {
  if (error.graphQLErrors && error.graphQLErrors.length > 0) {
    return {
      message: error.graphQLErrors[0].message,
      code: error.graphQLErrors[0].extensions?.code || 'GRAPHQL_ERROR',
      details: error.graphQLErrors[0].extensions,
    }
  }

  if (error.networkError) {
    return {
      message: error.networkError.message,
      code: 'NETWORK_ERROR',
      details: error.networkError,
    }
  }

  return {
    message: error.message || 'An unknown error occurred',
    code: 'UNKNOWN_ERROR',
    details: error,
  }
}
