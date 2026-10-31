import dayjs from 'dayjs'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'

export type CommissionHistoryTab = 'my' | 'subAgent'

export const COMMISSION_HISTORY_TABS: readonly { value: CommissionHistoryTab; label: string }[] = [
  { value: 'my', label: 'My Settlements' },
  { value: 'subAgent', label: 'Sub-agent Settlements' },
]

export const COMMISSION_HISTORY_PAGE_SIZES = [10, 20, 50, 100] as const
export const COMMISSION_HISTORY_DEFAULT_PAGE_SIZE = 50
export const COMMISSION_HISTORY_DATE_PRESETS = [{ value: 'custom', label: 'Custom range' }] as const

export interface CommissionPayoutItem {
  id: string
  agentId: string
  agent?: { id: string; username?: string | null; schemeType: string } | null
  amount: number
  periodFrom?: string | null
  periodTo?: string | null
  notes?: string | null
  paidBy?: string | null
  createdAt: string
}

export function historyTabFromParams(tab: string | null, subAgentId: string | null): CommissionHistoryTab {
  if (tab === 'my' || tab === 'subAgent') return tab
  return subAgentId ? 'subAgent' : 'my'
}

export function weekLabel(periodFrom?: string | null, periodTo?: string | null): string {
  if (!periodFrom || !periodTo) return '—'
  const from = dayjs.utc(periodFrom).tz('Asia/Kolkata')
  const to = dayjs.utc(periodTo).tz('Asia/Kolkata')
  return `${from.format('DD MMM')} – ${to.format('DD MMM YYYY')} (IST)`
}

export function paidAtLabel(value: string): string {
  return dayjs.utc(value).tz('Asia/Kolkata').format('DD MMM YYYY HH:mm')
}

export function subAgentLabel(item: Pick<CommissionPayoutItem, 'agent' | 'agentId'>): string {
  return item.agent?.username ?? item.agentId?.slice(0, 8) ?? '—'
}

export function activeCommissionHistoryFilters(tab: CommissionHistoryTab, subAgentId?: string): number {
  return tab === 'subAgent' && subAgentId ? 1 : 0
}

export function applyHistoryDateRange(
  current: readonly [string, string],
  payload: DateRangeApply,
): [string, string] {
  return payload.kind === 'custom' ? [payload.from, payload.to] : [...current]
}

export function subAgentOptions(
  summaries: readonly { agentId: string; username?: string | null }[],
): { value: string; label: string }[] {
  return [
    { value: 'all', label: 'All sub-agents' },
    ...summaries.map((summary) => ({
      value: summary.agentId,
      label: summary.username || summary.agentId.slice(0, 8) || summary.agentId,
    })),
  ]
}
