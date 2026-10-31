import { getAppConfig } from '../config/app.js'
import type { ResolverContext } from '../types/context.js'
import type { ApiResponse } from '@shared/types/api.js'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

type UpstreamRequest = {
  path: string
  method: HttpMethod
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
}

const config = getAppConfig()

function buildUrl(path: string, query?: UpstreamRequest['query']): string {
  const base = config.upstreamApiBaseUrl.replace(/\/$/, '')
  const url = new URL(path.startsWith('/') ? `${base}${path}` : `${base}/${path}`)
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      url.searchParams.set(key, String(value))
    })
  }
  return url.toString()
}

export async function upstreamRequest<T = unknown>(ctx: ResolverContext, req: UpstreamRequest): Promise<ApiResponse<T>> {
  const url = buildUrl(req.path, req.query)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ctx.auth.rawToken) {
    headers.Authorization = `Bearer ${ctx.auth.rawToken}`
  }

  const response = await fetch(url, {
    method: req.method,
    headers,
    body: req.body ? JSON.stringify(req.body) : undefined,
    signal: AbortSignal.timeout(8000),
  })

  const payload = (await response.json().catch(() => ({}))) as ApiResponse<T> | { message?: string }

  if (!response.ok) {
    const message = (payload as any)?.message || (payload as any)?.meta?.message || 'Upstream request failed'
    throw new Error(message)
  }

  // Ensure meta at least contains code
  const meta = (payload as ApiResponse<T>).meta || { code: response.status }
  return { ...(payload as ApiResponse<T>), meta }
}

