import axios, { AxiosError } from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { tokenService } from './tokenService'
import { getWhitelabelId, isWhitelabelIdFromEnv } from './whitelabel'

type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null
let tokenGetter: (() => string | null) | null = null

export function setGraphqlUnauthorizedHandler(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler
}

export function setGraphqlAuthTokenGetter(getter: () => string | null) {
  tokenGetter = getter
}

const graphqlBase =
  import.meta.env.VITE_USER_GRAPHQL_URL ||
  (import.meta.env.VITE_API_BASE_URL
    ? `${import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '')}/graphql`
    : '/graphql')

const graphqlClient = axios.create({
  baseURL: graphqlBase,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

graphqlClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  let token: string | null = null
  try {
    token = tokenGetter ? tokenGetter() : null
    if (!token && typeof window !== 'undefined') {
      token = window.localStorage.getItem('token')
    }
  } catch (_) {}
  
  // Check token expiration before making request
  if (token) {
    if (tokenService.isTokenExpired(token)) {
      // Token is expired, clear auth and trigger unauthorized handler
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('token')
          window.localStorage.removeItem('stakex_user')
        }
      } catch (_) {}
      if (unauthorizedHandler) unauthorizedHandler()
      return Promise.reject(new Error('Session expired'))
    }
    
    if (config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  
  // Add tenant header - fully managed by VITE_WHITELABEL_ID env variable
  if (config.headers && typeof window !== 'undefined') {
    const whitelabelId = getWhitelabelId()
    const fromEnv = isWhitelabelIdFromEnv()
    
    // Always use the whitelabel ID (from env or domain fallback)
    config.headers['x-tenant'] = whitelabelId
    config.headers['x-whitelabel-id'] = whitelabelId
    
    // Send hostname for domain-based fallback on backend only if env is not set
    if (!fromEnv) {
      config.headers['x-whitelabel'] = window.location.hostname
    }
  }
  
  return config
})

graphqlClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error?.response?.status === 401) {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('token')
          window.localStorage.removeItem('stakex_user')
        }
      } catch (_) {}
      if (unauthorizedHandler) unauthorizedHandler()
    }
    return Promise.reject(error)
  }
)

export async function graphqlRequest<T>(query: string, variables?: Record<string, unknown>, customHeaders?: Record<string, string>): Promise<T> {
  const config = customHeaders ? { headers: customHeaders } : undefined
  const res = await graphqlClient.post<{ data?: T; errors?: Array<{ message?: string }> }>('', { query, variables }, config)
  if (res.data.errors?.length) {
    const message = res.data.errors[0]?.message || 'Request failed'
    
    // Check for authentication-related errors that should clear auth state
    const authErrors = ['User not found', 'Unauthorized', 'User not found', 'Invalid token', 'Token expired']
    const shouldClearAuth = authErrors.some(authError => 
      message.toLowerCase().includes(authError.toLowerCase())
    )
    
    if (shouldClearAuth) {
      // If message is "Token expired" from backend preExecution hook, it means
      // token version mismatch (single-device enforcement: logged in from another device).
      // Dispatch a custom event so the auth provider can show a user-friendly message.
      if (message === 'Token expired') {
        try { window.dispatchEvent(new CustomEvent('session-replaced')) } catch (_) {}
      }
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('token')
          window.localStorage.removeItem('stakex_user')
        }
      } catch (_) {}
      if (unauthorizedHandler) unauthorizedHandler()
    }
    
    throw new Error(message)
  }
  if (!res.data || typeof res.data.data === 'undefined') {
    throw new Error('Malformed GraphQL response')
  }
  return res.data.data as T
}

export default graphqlClient

