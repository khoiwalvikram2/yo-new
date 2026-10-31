import { IconX } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import styles from './AuditSurfaces.module.css'
import type { AuditFilters } from '@/state/auditStore'
import { useFormatDate } from '@/shared/core/useFormatDate'

interface FilterChipsProps {
  filters: AuditFilters
  onFiltersChange: (filters: Partial<AuditFilters>) => void
  onClearAll: () => void
}

export function FilterChips({ filters, onFiltersChange, onClearAll }: FilterChipsProps) {
  const { formatDate } = useFormatDate()
  const chips: Array<{ key: string; label: string; onClose: () => void }> = []

  if (filters.id) {
    chips.push({
      key: 'id',
      label: `ID: ${filters.id}`,
      onClose: () => onFiltersChange({ id: undefined, page: 1 }),
    })
  }

  if (filters.domain && filters.domain.length > 0) {
    filters.domain.forEach((domain) => {
      chips.push({
        key: `domain-${domain}`,
        label: `Domain: ${domain}`,
        onClose: () => {
          const newDomains = filters.domain?.filter((d) => d !== domain)
          onFiltersChange({
            domain: newDomains && newDomains.length > 0 ? newDomains : undefined,
            page: 1,
          })
        },
      })
    })
  }

  if (filters.action && filters.action.length > 0) {
    filters.action.forEach((action) => {
      chips.push({
        key: `action-${action}`,
        label: `Action: ${action}`,
        onClose: () => {
          const newActions = filters.action?.filter((a) => a !== action)
          onFiltersChange({
            action: newActions && newActions.length > 0 ? newActions : undefined,
            page: 1,
          })
        },
      })
    })
  }

  if (filters.actorId) {
    chips.push({
      key: 'actorId',
      label: `Actor: ${filters.actorId}`,
      onClose: () => onFiltersChange({ actorId: undefined, page: 1 }),
    })
  }

  if (filters.resourceType && filters.resourceType.length > 0) {
    filters.resourceType.forEach((type) => {
      chips.push({
        key: `resourceType-${type}`,
        label: `Resource: ${type}`,
        onClose: () => {
          const newTypes = filters.resourceType?.filter((t) => t !== type)
          onFiltersChange({
            resourceType: newTypes && newTypes.length > 0 ? newTypes : undefined,
            page: 1,
          })
        },
      })
    })
  }

  if (filters.resourceId) {
    chips.push({
      key: 'resourceId',
      label: `Resource ID: ${filters.resourceId}`,
      onClose: () => onFiltersChange({ resourceId: undefined, page: 1 }),
    })
  }

  if (filters.from || filters.to) {
    chips.push({
      key: 'dateRange',
      label: `Date: ${filters.from ? formatDate(filters.from) : '...'} - ${filters.to ? formatDate(filters.to) : '...'}`,
      onClose: () => onFiltersChange({ from: undefined, to: undefined, page: 1 }),
    })
  }

  if (filters.search) {
    chips.push({
      key: 'search',
      label: `Search: ${filters.search}`,
      onClose: () => onFiltersChange({ search: undefined, page: 1 }),
    })
  }

  if (chips.length === 0) {
    return null
  }

  return <div className={styles.chips} aria-label="Active audit filters">
    {chips.map((chip) => <Button key={chip.key} size="xs" variant="pill" aria-label={`Remove ${chip.label}`} onClick={chip.onClose} icon={<IconX size={14} />}>{chip.label}</Button>)}
    <Button size="xs" variant="ghost" onClick={onClearAll}>Clear All</Button>
  </div>
}
