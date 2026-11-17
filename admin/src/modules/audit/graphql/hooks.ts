import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useSubscription } from '@apollo/client'
import { toast } from '@/ui/components/toast'
import { AUDIT_EVENTS_SUBSCRIPTION } from './subscriptions'
import { AUDIT_FILTER_OPTIONS_QUERY } from './queries'
import { ACTION_OPTIONS, DOMAIN_OPTIONS, RESOURCE_TYPE_OPTIONS } from '../constants'
import type { AuditFilters } from '@/state/auditStore'

export interface AuditFilterOptionLists {
  domains: readonly string[]
  actions: readonly string[]
  resourceTypes: readonly string[]
}

/** The lists a trail can be filtered by before (or without) the tenant's own: names the trail records. */
export const FALLBACK_AUDIT_FILTER_OPTIONS: AuditFilterOptionLists = { domains: DOMAIN_OPTIONS, actions: ACTION_OPTIONS, resourceTypes: RESOURCE_TYPE_OPTIONS }

/**
 * The Domain, Action and Resource Type values this tenant's trail holds, for the filter lists. A failure is
 * quiet (skipNotification): the lists fall back to the fixed ones, and the page works either way.
 */
export function useAuditFilterOptions(enabled = true): AuditFilterOptionLists {
  const { data } = useQuery<{ auditFilterOptions: AuditFilterOptionLists }>(AUDIT_FILTER_OPTIONS_QUERY, {
    skip: !enabled,
    errorPolicy: 'all',
    context: { skipNotification: true },
  })
  const served = data?.auditFilterOptions
  return useMemo(() => (served?.domains?.length || served?.actions?.length ? served : FALLBACK_AUDIT_FILTER_OPTIONS), [served])
}

interface AuditEventPayload {
  id: string
  domain?: string
  action?: string
  actorId?: string
  actor?: { name?: string }
}

interface UseAuditSubscriptionOptions {
  filters?: Partial<AuditFilters>
  enabled?: boolean
  onNewEvent?: (event: AuditEventPayload) => void
}

/**
 * React hook for real-time audit event subscription
 */
export function useAuditSubscription(options: UseAuditSubscriptionOptions = {}) {
  const { filters, enabled = true, onNewEvent } = options
  const notificationShownRef = useRef<Set<string>>(new Set())

  const { data, error } = useSubscription(AUDIT_EVENTS_SUBSCRIPTION, {
    variables: { filters },
    skip: !enabled,
    errorPolicy: 'all',
  })

  useEffect(() => {
    if (data?.auditEvents && enabled) {
      const event = data.auditEvents

      // Prevent duplicate notifications for the same event
      if (notificationShownRef.current.has(event.id)) {
        return
      }

      notificationShownRef.current.add(event.id)

      // Show toast notification
      const actorName = event.actor?.name || event.actorId
      toast({ title: 'New Audit Event', message: `${event.domain}.${event.action} by ${actorName}`, tone: 'info', duration: 3000 })

      // Call custom callback if provided
      if (onNewEvent) {
        onNewEvent(event)
      }

      // Clean up notification ref after 5 seconds to allow re-notification if needed
      setTimeout(() => {
        notificationShownRef.current.delete(event.id)
      }, 5000)
    }
  }, [data, enabled, onNewEvent])

  useEffect(() => {
    if (!error) return
    const isPermissionError =
      /insufficient permissions|forbidden/i.test(error.message || '')
    if (isPermissionError) {
      return
    }
    toast({ title: 'Audit live updates disconnected', message: error.message || 'Real-time updates may have stopped. Refresh the page to reconnect.', tone: 'warn' })
  }, [error])

  return {
    data: data?.auditEvents,
    error,
  }
}
