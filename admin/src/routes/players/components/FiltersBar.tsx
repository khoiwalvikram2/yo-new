import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { DateField } from '@/ui/components/DateField'

type AgentOption = {
  id: string;
  username?: string | null;
  /** Secondary text, e.g. the agent's level in the hierarchy. */
  description?: string;
};

type FiltersBarProps = {
  query: string
  status: string
  balanceRange: string
  registered: string
  registeredRange?: { from?: string; to?: string }
  onChangeQuery: (v: string) => void
  onChangeStatus: (v: string) => void
  onChangeBalanceRange: (v: string) => void
  onChangeRegistered: (v: string) => void
  onChangeRegisteredRange?: (range: { from?: string; to?: string }) => void
  onClearAll: () => void
  // Agent filter props
  parentType?: string
  agentId?: string
  onChangeAgentId?: (v: string | undefined) => void
  agentsForSelector?: AgentOption[]
  showAgentFilter?: boolean
  // Player type filter (All / Regular / Whitelabel credit) - only when tab is ALL or DIRECT
  showPlayerTypeFilter?: boolean
  playerTypeFilter?: '' | 'REGULAR' | 'WHITELABEL_CREDIT'
  onChangePlayerTypeFilter?: (v: '' | 'REGULAR' | 'WHITELABEL_CREDIT') => void
}


export function FiltersBar({
  query, status, balanceRange, registered, registeredRange, onChangeQuery, onChangeStatus,
  onChangeBalanceRange, onChangeRegistered, onChangeRegisteredRange, onClearAll, parentType,
  agentId, onChangeAgentId, agentsForSelector = [], showAgentFilter = false,
  showPlayerTypeFilter = false, playerTypeFilter = '', onChangePlayerTypeFilter,
}: FiltersBarProps) {
  const { formatAmount } = useCurrency()
  const from = registeredRange?.from ? dayjs(registeredRange.from).tz('Asia/Kolkata').format('YYYY-MM-DD') : ''
  const to = registeredRange?.to ? dayjs(registeredRange.to).tz('Asia/Kolkata').format('YYYY-MM-DD') : ''
  const [draft, setDraft] = useState({ from, to })
  useEffect(() => { setDraft({ from, to }) }, [from, to])
  const count = [query, status, balanceRange, registered,
    registered === 'custom' && registeredRange?.from && registeredRange?.to ? 'customRange' : null,
    agentId, showPlayerTypeFilter && playerTypeFilter ? playerTypeFilter : null].filter(Boolean).length
  function updateDate(key: 'from' | 'to', value: string) {
    const next = { ...draft, [key]: value }; setDraft(next)
    onChangeRegisteredRange?.(next.from && next.to ? {
      from: dayjs.tz(next.from, 'Asia/Kolkata').startOf('day').toISOString(),
      to: dayjs.tz(next.to, 'Asia/Kolkata').endOf('day').toISOString(),
    } : {})
  }
  return <FilterBar label="Player filters" activeCount={count} onClearAll={onClearAll}
    search={<SearchField label="Search players" value={query} placeholder="Search name, email, phone or ID…" onChange={onChangeQuery} />}>
    <Select hideLabel label="Status" value={status} onChange={onChangeStatus} options={[{ value: '', label: 'All Status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'suspended', label: 'Suspended' }]} />
    <Select hideLabel label="Balance" value={balanceRange} onChange={onChangeBalanceRange} options={[
      { value: '', label: 'All Ranges' }, ...['0-100', '100-1000', '1000-10000'].map(value => ({ value, label: value.split('-').map(n => formatAmount(Number(n))).join(' - ') })),
      { value: '10000+', label: formatAmount(10000) + '+' },
    ]} />
    <Select hideLabel label="Registration" value={registered} onChange={value => { onChangeRegistered(value); if (value !== 'custom') { setDraft({ from: '', to: '' }); onChangeRegisteredRange?.({}) } }} options={[{ value: '', label: 'All Time' }, { value: '7days', label: 'Last 7 days' }, { value: '30days', label: 'Last 30 days' }, { value: '90days', label: 'Last 90 days' }, { value: 'custom', label: 'Custom Range' }]} />
    {registered === 'custom' && <><DateField label="Start date" value={draft.from} onChange={value => updateDate('from', value)} max={draft.to || undefined} /><DateField label="End date" value={draft.to} onChange={value => updateDate('to', value)} min={draft.from || undefined} /></>}
    {showAgentFilter && parentType !== 'DIRECT' && <Combobox hideLabel label="Filter by agent" value={agentId || ''} onChange={value => onChangeAgentId?.(value || undefined)} options={agentsForSelector.map(agent => ({ label: agent.username || agent.id, value: agent.id, description: agent.description }))} clearable placeholder="Filter by agent" />}
    {showPlayerTypeFilter && <Select hideLabel label="Player type" value={playerTypeFilter} onChange={value => onChangePlayerTypeFilter?.(value === 'REGULAR' || value === 'WHITELABEL_CREDIT' ? value : '')} options={[{ value: '', label: 'All player types' }, { value: 'REGULAR', label: 'Regular players' }, { value: 'WHITELABEL_CREDIT', label: 'Whitelabel credit players' }]} />}
  </FilterBar>
}
