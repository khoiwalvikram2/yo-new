export interface AuditEvent {
  id: string
  tenant?: string
  actorId: string
  actor?: ActorInfo
  domain: string
  action: string
  resourceType: string
  resourceId: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  timestamp: string
}

export interface ActorInfo {
  id: string
  name?: string
  email?: string
  type: 'admin' | 'agent' | 'system'
  role?: string
}

/** Align with store: use from/to for date range (URL and API). */
export interface AuditFilters {
  domain?: string[]
  action?: string[]
  actorId?: string
  resourceType?: string[]
  resourceId?: string
  from?: string
  to?: string
  search?: string
  page?: number
  limit?: number
  sort?: string
  tenant?: string
}

export interface AuditStats {
  total: number
  today: number
  byDomain: Array<{ domain: string; count: number }>
  byAction: Array<{ action: string; count: number }>
  uniqueActors: number
  recentEvents: AuditEvent[]
}

export interface SavedFilterPreset {
  id: string
  name: string
  description?: string
  filters: AuditFilters
  isPinned: boolean
  createdAt: string
}

export interface AuditEventPage {
  items: AuditEvent[]
  total: number
  page?: number
  pageSize?: number
}

export interface AuditAnnotation {
  id: string
  auditEventId: string
  createdBy?: string
  note: string
  createdAt: string
  updatedAt: string
}

