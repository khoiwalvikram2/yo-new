import type { AuditFilters } from '@/state/auditStore'

/**
 * Clean and normalize filter objects for GraphQL (backend expects domain, action, resourceType as arrays or single)
 */
export function cleanAuditFilters(filters: Partial<AuditFilters>): AuditFilters {
  const cleaned: Partial<AuditFilters> = {}
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      if (key === 'domain' || key === 'action' || key === 'resourceType') {
        if (Array.isArray(value)) {
          (cleaned as Record<string, unknown>)[key] = value.filter((v) => v !== null && v !== undefined && v !== '')
        } else if (value) {
          (cleaned as Record<string, unknown>)[key] = [value]
        }
      } else {
        (cleaned as Record<string, unknown>)[key] = value
      }
    }
  })
  if (cleaned.from && cleaned.to) {
    const fromDate = new Date(cleaned.from)
    const toDate = new Date(cleaned.to)
    if (fromDate > toDate) {
      ;[cleaned.from, cleaned.to] = [cleaned.to, cleaned.from]
    }
  }
  if (cleaned.page !== undefined) {
    cleaned.page = Math.max(1, parseInt(String(cleaned.page), 10) || 1)
  }
  if (cleaned.limit !== undefined) {
    cleaned.limit = Math.max(1, Math.min(500, parseInt(String(cleaned.limit), 10) || 100))
  }
  if (cleaned.sort && typeof cleaned.sort !== 'string') {
    cleaned.sort = String(cleaned.sort)
  }
  return {
    page: 1,
    limit: 100,
    sort: 'timestamp:desc',
    ...cleaned,
  } as AuditFilters
}

export function getDefaultFilters(): AuditFilters {
  return {
    page: 1,
    limit: 100,
    sort: 'timestamp:desc',
  }
}

export function serializeFiltersToURL(filters: Partial<AuditFilters>): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.id) params.set('id', filters.id)
  if (filters.domain && filters.domain.length > 0) params.set('domain', filters.domain.join(','))
  if (filters.action && filters.action.length > 0) params.set('action', filters.action.join(','))
  if (filters.actorId) params.set('actorId', filters.actorId)
  if (filters.resourceType && filters.resourceType.length > 0) params.set('resourceType', filters.resourceType.join(','))
  if (filters.resourceId) params.set('resourceId', filters.resourceId)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.search) params.set('search', filters.search)
  if (filters.page && filters.page > 1) params.set('page', String(filters.page))
  if (filters.limit && filters.limit !== 100) params.set('limit', String(filters.limit))
  if (filters.sort && filters.sort !== 'timestamp:desc') params.set('sort', filters.sort)
  return params
}

export function deserializeFiltersFromURL(searchParams: URLSearchParams): Partial<AuditFilters> {
  const filters: Partial<AuditFilters> = {}
  const id = searchParams.get('id')
  if (id) filters.id = id
  const domain = searchParams.get('domain')
  if (domain) filters.domain = domain.split(',').filter((d) => d.trim())
  const action = searchParams.get('action')
  if (action) filters.action = action.split(',').filter((a) => a.trim())
  const actorId = searchParams.get('actorId')
  if (actorId) filters.actorId = actorId
  const resourceType = searchParams.get('resourceType')
  if (resourceType) filters.resourceType = resourceType.split(',').filter((r) => r.trim())
  const resourceId = searchParams.get('resourceId')
  if (resourceId) filters.resourceId = resourceId
  const from = searchParams.get('from')
  if (from) filters.from = from
  const to = searchParams.get('to')
  if (to) filters.to = to
  const search = searchParams.get('search')
  if (search) filters.search = search
  const page = searchParams.get('page')
  if (page) {
    const pageNum = parseInt(page, 10)
    if (!isNaN(pageNum) && pageNum > 0) filters.page = pageNum
  }
  const limit = searchParams.get('limit')
  if (limit) {
    const limitNum = parseInt(limit, 10)
    if (!isNaN(limitNum) && limitNum > 0) filters.limit = limitNum
  }
  const sort = searchParams.get('sort')
  if (sort) filters.sort = sort
  return filters
}
