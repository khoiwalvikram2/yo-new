import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery, gql } from '@apollo/client'
import { Combobox } from '@/ui/components/Combobox'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { FilterBar } from '@/ui/components/FilterBar'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Select } from '@/ui/components/Select'
import {
  BONUS_AWARD_DOMAIN_OPTIONS,
  BONUS_AWARD_STATUS_OPTIONS,
  BONUS_AWARDS_DATE_PRESETS,
  bonusAwardsToday,
  countActiveBonusAwardFilters,
  getBonusAwardsPresetFromRange,
  getBonusAwardsRangeForPreset,
  lookupEmptyText,
  toAgentOptions,
  toPlayerOptions,
  type BonusAwardsDatePreset,
  type BonusAwardsListFiltersState,
  type LookupOption,
} from '../bonusAwardsModel'
import styles from '../BonusAwardsListPage.module.css'

const AGENTS_FOR_BONUS_FILTER_QUERY = gql`
  query AgentsForBonusAwardsFilter($query: String, $limit: Int) {
    agents {
      agentsPage(query: $query, limit: $limit, offset: 0) {
        items {
          id
          username
        }
        total
      }
    }
  }
`

const PLAYERS_FOR_BONUS_FILTER_QUERY = gql`
  query PlayersForBonusAwardsFilter($query: String, $limit: Int, $agentId: ID) {
    usersPage(query: $query, limit: $limit, offset: 0, agentId: $agentId) {
      items {
        id
        username
        name
        phone
      }
      total
    }
  }
`

// The legacy status options are the raw API values, lower case, as before.
const STATUS_OPTIONS = BONUS_AWARD_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))

// A native select cannot be cleared, so "no domain" is the first option (antd: placeholder + allowClear).
const DOMAIN_OPTIONS = [{ value: '', label: 'All domains' }, ...BONUS_AWARD_DOMAIN_OPTIONS]

// The legacy bar was titled "Filters"; the name also labels the compact trigger below 1024px.
const FILTERS_LABEL = 'Filters'

type BonusAwardsFiltersBarProps = {
  filters: BonusAwardsListFiltersState
  onFiltersChange: Dispatch<SetStateAction<BonusAwardsListFiltersState>>
  onClear: () => void
  isAgent: boolean
  campaignOptions: LookupOption[]
  campaignsLoading?: boolean
}

export function BonusAwardsFiltersBar({
  filters,
  onFiltersChange,
  onClear,
  isAgent,
  campaignOptions,
  campaignsLoading = false,
}: BonusAwardsFiltersBarProps) {
  const [agentSearchQuery, setAgentSearchQuery] = useState('')
  const [playerSearchQuery, setPlayerSearchQuery] = useState('')
  /* antd's Select cleared its search text after a pick without calling onSearch; the kit field reports
     that clearing as onInputChange(''). A pick therefore marks the next empty search as its own, so it
     does not wipe the player just chosen. Any other empty search (closing the list without a pick,
     deleting the text) clears the player filter, as antd's onSearch('') did. */
  const playerPickedRef = useRef(false)

  const appliedPreset = getBonusAwardsPresetFromRange(filters.dateFrom, filters.dateTo)

  const handleCustomRangeChange = (from: string | undefined, to: string | undefined) => {
    onFiltersChange((prev) => ({
      ...prev,
      dateFrom: from ?? prev.dateFrom,
      dateTo: to ?? prev.dateTo,
    }))
  }

  /* A preset applies its IST window; a custom range applies its two days (the panel refuses a reversed
     range, where the legacy RangePicker swapped it). Custom alone changes nothing, as before. */
  const handleDateApply = (payload: DateRangeApply) => {
    if (payload.kind === 'custom') {
      handleCustomRangeChange(payload.from, payload.to)
      return
    }
    const range = getBonusAwardsRangeForPreset(payload.preset as BonusAwardsDatePreset)
    if (range) onFiltersChange((prev) => ({ ...prev, dateFrom: range.from, dateTo: range.to }))
  }

  const handleDateReset = () => {
    const range = getBonusAwardsRangeForPreset('today')
    if (range) onFiltersChange((prev) => ({ ...prev, dateFrom: range.from, dateTo: range.to }))
  }

  const shouldFetchAgents = !isAgent && agentSearchQuery.trim().length >= 2
  const { data: agentsData, loading: agentsLoading } = useQuery(AGENTS_FOR_BONUS_FILTER_QUERY, {
    variables: { query: agentSearchQuery.trim() || undefined, limit: 50 },
    skip: !shouldFetchAgents,
    fetchPolicy: 'cache-and-network',
  })

  const shouldFetchPlayers = playerSearchQuery.trim().length >= 2
  const { data: playersData, loading: playersLoading } = useQuery(PLAYERS_FOR_BONUS_FILTER_QUERY, {
    variables: {
      query: playerSearchQuery.trim() || undefined,
      limit: 50,
      agentId: undefined,
    },
    skip: !shouldFetchPlayers,
    fetchPolicy: 'cache-and-network',
  })

  const agentOptions = useMemo(() => toAgentOptions(agentsData?.agents?.agentsPage?.items), [agentsData])

  const playerOptions = useMemo(() => toPlayerOptions(playersData?.usersPage?.items), [playersData])

  const todayStr = bonusAwardsToday()
  const activeFiltersCount = countActiveBonusAwardFilters(filters, isAgent, todayStr)

  const handlePlayerSearch = (v: string) => {
    if (v === '' && playerPickedRef.current) {
      playerPickedRef.current = false
      setPlayerSearchQuery('')
      return
    }
    playerPickedRef.current = false
    setPlayerSearchQuery(v)
    onFiltersChange((prev) => ({ ...prev, playerSearch: v.trim() || undefined }))
  }

  return (
    <FilterBar
      label={FILTERS_LABEL}
      activeCount={activeFiltersCount}
      onClearAll={onClear}
      search={(
        <Combobox
          label="Player"
          hideLabel
          placeholder="Player"
          size="sm"
          clearable
          filter={false}
          loading={playersLoading}
          emptyText={lookupEmptyText(playerSearchQuery, 'players')}
          options={playerOptions}
          value={filters.playerSearch ?? null}
          onInputChange={handlePlayerSearch}
          onSelect={() => {
            playerPickedRef.current = true
          }}
          onChange={(v) => {
            if (v == null) playerPickedRef.current = false
            onFiltersChange((prev) => ({ ...prev, playerSearch: v ?? undefined }))
          }}
          className={styles.playerField}
        />
      )}
    >
      <MultiSelect
        label="Status"
        hideLabel
        placeholder="Status"
        size="sm"
        clearable
        maxTagCount={1}
        options={STATUS_OPTIONS}
        value={filters.status ?? []}
        onChange={(v) => onFiltersChange((prev) => ({ ...prev, status: v?.length ? v : undefined }))}
        className={styles.statusField}
      />
      <Select
        label="Domain"
        hideLabel
        size="sm"
        options={DOMAIN_OPTIONS}
        value={filters.domain}
        onChange={(v) => onFiltersChange((prev) => ({ ...prev, domain: v }))}
        className={styles.domainField}
      />
      {!isAgent && (
        <Combobox
          label="Campaign"
          hideLabel
          placeholder="Campaign"
          size="sm"
          clearable
          loading={campaignsLoading}
          options={campaignOptions}
          value={filters.campaignId != null ? String(filters.campaignId) : null}
          onChange={(v) => onFiltersChange((prev) => ({ ...prev, campaignId: v == null ? undefined : Number(v) }))}
          className={styles.campaignField}
        />
      )}
      <DateRangeField
        label="Date range"
        presets={BONUS_AWARDS_DATE_PRESETS}
        appliedPreset={appliedPreset}
        appliedFrom={filters.dateFrom}
        appliedTo={filters.dateTo}
        onApply={handleDateApply}
        onReset={handleDateReset}
      />
      {!isAgent && (
        <Combobox
          label="Agent"
          hideLabel
          placeholder="Agent"
          size="sm"
          clearable
          filter={false}
          loading={agentsLoading}
          emptyText={lookupEmptyText(agentSearchQuery, 'agents')}
          options={agentOptions}
          value={filters.agentUsername ?? null}
          onInputChange={setAgentSearchQuery}
          onChange={(v) => onFiltersChange((prev) => ({ ...prev, agentUsername: v ?? undefined }))}
          className={styles.agentField}
        />
      )}
    </FilterBar>
  )
}
