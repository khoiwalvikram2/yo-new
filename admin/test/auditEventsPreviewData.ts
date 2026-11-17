import type { Operation, FetchResult } from '@apollo/client'
import type { SelectionSetNode } from 'graphql'
import type { AuditEvent } from '../src/modules/audit/types'
export const auditFixtureEvent: AuditEvent = { id: 'event-1', actorId: 'admin-1', actor: { id: 'admin-1', name: 'Preview operator', email: 'preview@example.test', type: 'admin' }, domain: 'players', action: 'update', resourceType: 'player', resourceId: 'player-1', before: { status: 'active', limit: 100 }, after: { status: 'suspended', limit: 150 }, timestamp: '2026-10-09T10:00:00.000Z' }
export interface AuditFixtureOptions { refuseJob?: boolean; failEvents?: boolean; jobCreated?: boolean }
function complete(selection: SelectionSetNode, value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value)) return value.map((entry) => complete(selection, entry))
  const source = value as Record<string, unknown>
  return Object.fromEntries(selection.selections.filter((node) => node.kind === 'Field').map((field) => {
    const key = field.alias?.value || field.name.value
    const raw = field.name.value === '__typename' ? source[key] || 'AuditFixture' : source[key] ?? null
    return [key, field.selectionSet ? complete(field.selectionSet, raw) : raw]
  }))
}
export function auditFixtureResponse(operation: Operation, options: AuditFixtureOptions = {}): FetchResult {
  const definition = operation.query.definitions.find((node) => node.kind === 'OperationDefinition')
  if (!definition || definition.kind !== 'OperationDefinition') throw new Error('Missing audit fixture operation')
  let result: Record<string, unknown>
  const event = { __typename: 'AuditEvent', ...auditFixtureEvent, actor: { __typename: 'AuditActor', ...auditFixtureEvent.actor } }
  const filters = operation.variables.filters as Record<string, unknown> | undefined
  switch (operation.operationName) {
    case 'AuditEvents':
      if (definition.operation === 'subscription') result = { auditEvents: event }
      else {
        if (options.failEvents) throw new Error('Insufficient permissions')
        const page = Number(filters?.page || 1)
        const related = filters?.actorId || filters?.resourceId
        result = { auditEvents: { __typename: 'AuditEventPage', items: related ? [event, { ...event, id: 'event-related', action: 'create' }] : [event, { ...event, id: `event-${page + 1}`, domain: 'sports', resourceId: 'sport-1' }], total: related ? 2 : 230, page, pageSize: Number(filters?.limit || 100) } }
      }
      break
    case 'AuditStats': result = { auditStats: { total: 230, today: 20, uniqueActors: 12, byDomain: [{ domain: 'players', count: 130 }, { domain: 'sports', count: 100 }], byAction: [{ action: 'update', count: 230 }], recentEvents: [event] } }; break
    case 'AuditExportCSV': result = { auditExportCSV: 'id,domain\nevent-1,players' }; break
    case 'AuditExportJobsPage':
    case 'AuditExportJobs': result = { auditExportJobs: [{ id: 'job-ready', status: 'completed', exportFormat: 'CSV', createdAt: event.timestamp, completedAt: event.timestamp, fileUrl: 'audit-job-ready-1791540000000.csv' }, ...(options.jobCreated ? [{ id: 'job-new', status: 'pending', exportFormat: 'JSON', createdAt: event.timestamp }] : [])] }; break
    case 'CreateAuditExportJob': if (options.refuseJob) throw new Error('Export queue unavailable'); options.jobCreated = true; result = { createAuditExportJob: { id: 'job-new', status: 'pending', exportFormat: operation.variables.input.exportFormat, filtersJson: operation.variables.input.filtersJson, createdAt: event.timestamp } }; break
    case 'AuditAnnotations': result = { auditAnnotations: [] }; break
    case 'CreateAuditAnnotation': result = { createAuditAnnotation: { id: 'note-1', auditEventId: operation.variables.input.auditEventId, note: operation.variables.input.note, createdAt: event.timestamp, updatedAt: event.timestamp } }; break
    default: throw new Error(`Unexpected audit fixture operation: ${operation.operationName}`)
  }
  if (operation.operationName === 'AuditExportJobsPage') { const rows = (result.auditExportJobs ?? []) as unknown[]; result.auditExportJobsPage = { total: rows.length, items: rows.slice(operation.variables.offset ?? 0, (operation.variables.offset ?? 0) + (operation.variables.limit ?? 20)) }; }
  return { data: complete(definition.selectionSet, result) as Record<string, unknown> }
}
