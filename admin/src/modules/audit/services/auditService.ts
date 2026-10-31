import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export interface FormattedEvent {
  formattedTimestamp: string
  formattedTime: string
  relativeTime: string
}

/**
 * Formats an audit event's timestamp into human-readable strings.
 */
export function formatEvent(event: { timestamp?: string; createdAt?: string }): FormattedEvent {
  const timestamp = event?.timestamp || event?.createdAt
  const date = dayjs(timestamp)

  return {
    formattedTimestamp: date.isValid() ? date.format('MMM DD, YYYY') : '—',
    formattedTime: date.isValid() ? date.format('hh:mm:ss A') : '—',
    relativeTime: date.isValid() ? date.fromNow() : '—',
  }
}

/**
 * Safely parse JSON for before/after; returns null on invalid input.
 */
function safeParseJson(val: unknown): Record<string, unknown> | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) return val as Record<string, unknown>
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Returns a human-readable summary of the changes between before and after states.
 */
export function getChangeSummary(before: unknown, after: unknown): string {
  if (!before && !after) return 'No changes'
  if (!before && after) return 'Resource created'
  if (before && !after) return 'Resource deleted'

  const beforeObj = safeParseJson(before)
  const afterObj = safeParseJson(after)
  if (beforeObj === null && afterObj === null) return 'Unable to parse change data'

  const b = beforeObj ?? {}
  const a = afterObj ?? {}
  const changedKeys: string[] = []
  const allKeys = new Set([...Object.keys(b), ...Object.keys(a)])

  for (const key of allKeys) {
    if (JSON.stringify(b?.[key]) !== JSON.stringify(a?.[key])) {
      changedKeys.push(key)
    }
  }

  if (changedKeys.length === 0) return 'No changes detected'
  if (changedKeys.length === 1) return `Changed: ${changedKeys[0]}`
  if (changedKeys.length <= 3) return `Changed: ${changedKeys.join(', ')}`
  return `${changedKeys.length} fields changed`
}
