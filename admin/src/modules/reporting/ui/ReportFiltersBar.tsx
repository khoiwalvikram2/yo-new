import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import { IconRefresh } from '@tabler/icons-react'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { DateRangeField } from '@/ui/components/DateRangeField'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { strokeFor } from '@/ui/components/icons'
import { useReportingStore, type ReportingFilters } from '@/state/reportingStore'
import { AGENTS_SEARCH_QUERY, BONUS_CAMPAIGNS_QUERY } from '../drillDownQueries'
import {
  CURRENCY_OPTIONS,
  DOMAIN_OPTIONS,
  FILTER_RANGE_PRESETS,
  activeFilterCount,
  agentEmptyText,
  agentOptionsFrom,
  agentSearchSkipped,
  campaignEmptyText,
  campaignOptionsFrom,
  clearableOptions,
  clearedFilters,
  filterRangePreset,
} from './drillDownModel'
import styles from './ReportFiltersBar.module.css'

export interface ReportFiltersBarProps {
  onRefresh?: () => void
  showDomainFilter?: boolean
  showCurrencyFilter?: boolean
  showAgentFilter?: boolean
  showCampaignFilter?: boolean
  /**
   * BEYOND the legacy props: a date control to show instead of the built-in range field — the
   * reporting preset filter (modules/reporting/ui/ReportingPeriodFilter, Task 120) when a page uses it.
   */
  dateFilter?: ReactNode
  /** BEYOND the legacy props: `bare` drops the bar's own surface inside a Card. @default 'card' */
  surface?: 'card' | 'bare'
}

/**
 * The reporting store's filter row: date range, currency, domain, agent and campaign, Refresh and
 * Clear all. Same props, store writes and option queries as components/ReportFiltersBar.tsx; a page
 * migrates by switching the import.
 *
 * The agent and campaign lists searched inside an antd Select. Until the kit Combobox lands (it is
 * being built separately and is not imported here) each is a search box that feeds the same query,
 * beside a native select of its results.
 */
export function ReportFiltersBar({
  onRefresh,
  showDomainFilter = false,
  showCurrencyFilter = false,
  showAgentFilter = false,
  showCampaignFilter = false,
  dateFilter,
  surface = 'card',
}: ReportFiltersBarProps) {
  const { filters, setFilters } = useReportingStore()
  const [agentSearchQuery, setAgentSearchQuery] = useState('')
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('')
  const visibility = { showDomainFilter, showCurrencyFilter, showAgentFilter, showCampaignFilter }

  // Load agents
  const shouldSkipAgents = agentSearchSkipped(showAgentFilter, agentSearchQuery)
  const { data: agentsData, loading: agentsLoading } = useQuery(AGENTS_SEARCH_QUERY, {
    variables: {
      query: agentSearchQuery && agentSearchQuery.trim().length >= 2 ? agentSearchQuery.trim() : undefined,
      offset: 0,
      limit: 50,
    },
    skip: shouldSkipAgents,
    fetchPolicy: 'cache-and-network',
  })

  // Load campaigns
  const { data: campaignsData, loading: campaignsLoading } = useQuery(BONUS_CAMPAIGNS_QUERY, {
    variables: {
      search: campaignSearchQuery && campaignSearchQuery.trim().length >= 1 ? campaignSearchQuery.trim() : undefined,
    },
    skip: !showCampaignFilter,
    fetchPolicy: 'cache-and-network',
  })

  const agentOptions = useMemo(() => agentOptionsFrom(agentsData), [agentsData])
  const campaignOptions = useMemo(() => campaignOptionsFrom(campaignsData), [campaignsData])

  const activeFiltersCount = activeFilterCount(filters, visibility)

  const handleClearAll = () => {
    setFilters(clearedFilters(filters, visibility))
  }

  const dateControl = dateFilter ?? (
    <DateRangeField
      label="Date range"
      presets={FILTER_RANGE_PRESETS}
      appliedPreset={filterRangePreset(filters)}
      appliedFrom={filters.dateFrom}
      appliedTo={filters.dateTo}
      onApply={(payload) => {
        if (payload.kind === 'custom') setFilters({ dateFrom: payload.from, dateTo: payload.to })
        else if (payload.preset === 'all') setFilters({ dateFrom: undefined, dateTo: undefined })
      }}
      onReset={() => setFilters({ dateFrom: undefined, dateTo: undefined })}
    />
  )

  return (
    <div className={clsx(styles.root, surface === 'card' && styles.card)}>
      <div className={styles.filters}>
        <FilterBar activeCount={activeFiltersCount} onClearAll={handleClearAll}>
          {dateControl}
          {showCurrencyFilter ? (
            <Select
              label="Currency"
              hideLabel
              size="sm"
              className={styles.currency}
              value={filters.currency || 'USD'}
              options={CURRENCY_OPTIONS}
              onChange={(value) => setFilters({ currency: value })}
            />
          ) : null}
          {showDomainFilter ? (
            <Select
              label="Domain"
              hideLabel
              size="sm"
              className={styles.domain}
              value={filters.domain ?? ''}
              options={[{ label: 'All domains', value: '' }, ...DOMAIN_OPTIONS]}
              onChange={(value) => setFilters({ domain: (value || undefined) as ReportingFilters['domain'] })}
            />
          ) : null}
          {showAgentFilter ? (
            <div className={styles.pair}>
              <SearchField
                label="Search agents"
                placeholder="Search agents"
                size="sm"
                className={styles.search}
                value={agentSearchQuery}
                onChange={setAgentSearchQuery}
              />
              <Select
                label="Agent"
                hideLabel
                size="sm"
                className={styles.select}
                loading={agentsLoading}
                value={filters.agentId ?? ''}
                options={clearableOptions(
                  'All agents',
                  agentOptions,
                  filters.agentId,
                  agentEmptyText(agentsLoading, agentSearchQuery),
                )}
                onChange={(value) => setFilters({ agentId: value || undefined })}
              />
            </div>
          ) : null}
          {showCampaignFilter ? (
            <div className={styles.pair}>
              <SearchField
                label="Search campaigns"
                placeholder="Search campaigns"
                size="sm"
                className={styles.search}
                value={campaignSearchQuery}
                onChange={setCampaignSearchQuery}
              />
              <Select
                label="Campaign"
                hideLabel
                size="sm"
                className={styles.select}
                loading={campaignsLoading}
                value={filters.campaignId ?? ''}
                options={clearableOptions(
                  'All campaigns',
                  campaignOptions,
                  filters.campaignId,
                  campaignEmptyText(campaignsLoading),
                )}
                onChange={(value) => setFilters({ campaignId: value || undefined })}
              />
            </div>
          ) : null}
        </FilterBar>
      </div>
      {onRefresh ? (
        <Button
          size="sm"
          className={styles.refresh}
          icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      ) : null}
    </div>
  )
}
