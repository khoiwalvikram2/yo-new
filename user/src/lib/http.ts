import axios, { AxiosError } from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { tokenService } from './tokenService'

type UnauthorizedHandler = () => void
let unauthorizedHandler: UnauthorizedHandler | null = null
let tokenGetter: (() => string | null) | null = null

export function setUnauthorizedHandler(handler: UnauthorizedHandler) {
  unauthorizedHandler = handler
}

export function setAuthTokenGetter(getter: () => string | null) {
  tokenGetter = getter
}

const baseURL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'https://api.gamdaddy.com' : '/')

const http = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
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
      handleUnauthorized()
      return Promise.reject(new Error('Session expired'))
    }
    
    if (config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

http.interceptors.response.use(
  (response) => {
    const meta = (response?.data && (response as any).data?.meta) || null
    if (meta && (meta.code === 401 || meta.code === 0)) {
      handleUnauthorized()
    }
    return response
  },
  (error: AxiosError) => {
    if (error?.response?.status === 401) {
      handleUnauthorized()
    }
    return Promise.reject(error)
  }
)

function handleUnauthorized() {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('token')
      window.localStorage.removeItem('stakex_user')
    }
  } catch (_) {}
  if (unauthorizedHandler) unauthorizedHandler()
}

export default http


