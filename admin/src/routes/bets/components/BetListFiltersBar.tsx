import { useState, useMemo, useRef, type KeyboardEvent } from 'react'
import { useQuery, gql } from '@apollo/client'
import { Combobox, type ListboxOption } from '@/ui/components/Combobox'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { FilterBar } from '@/ui/components/FilterBar'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import {
  BET_DATE_PRESETS,
  BET_DOMAIN_OPTIONS,
  BET_WALLET_OPTIONS,
  betAgentEmptyText,
  betAgentFilterMode,
  betAgentOptions,
  betPlayerEmptyText,
  betSearchKeyAction,
  betPlayerOptions,
  betPlayerTextAfterPick,
  betStatusOptions,
  countActiveBetFilters,
  getBetRangeForPreset,
  isBetDatePreset,
  isBetDomain,
  showsBetWalletFilter,
  type BetAgentRow,
  type BetDatePreset,
  type BetDomain,
  type BetPlayerRow,
  type BetsPageFilters,
} from '../betListModel'
import styles from '../BetListPage.module.css'

const AGENTS_FOR_BET_FILTER_QUERY = gql`
  query AgentsForBetFilter($query: String, $limit: Int) {
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

const SUB_AGENTS_FOR_BET_FILTER_QUERY = gql`
  query SubAgentsForBetFilter($parentAgentId: ID!, $limit: Int) {
    agents {
      agentsPage(parentAgentId: $parentAgentId, limit: $limit, offset: 0) {
        items {
          id
          username
        }
        total
      }
    }
  }
`

const PLAYERS_FOR_BET_FILTER_QUERY = gql`
  query PlayersForBetFilter($query: String, $limit: Int, $agentId: ID) {
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

// The legacy phone layout titled this block "Filters"; it also names the compact trigger, and a longer
// name overflows the compact row at 375px (Task 101).
const FILTERS_LABEL = 'Filters'

// An open kit Combobox list and its active option, as the field's input exposes them to a key handler.
function listStateOf(input: HTMLInputElement) {
  return {
    listOpen: input.getAttribute('aria-expanded') === 'true',
    optionActive: input.hasAttribute('aria-activedescendant'),
  }
}

type BetListFiltersBarProps = {
  domain: BetDomain
  filters: BetsPageFilters
  onDomainChange: (v: BetDomain) => void
  onFiltersChange: (f: BetsPageFilters) => void
  onClear: () => void
  isAgent?: boolean
  agentId?: string
}

export function BetListFiltersBar({
  domain,
  filters,
  onDomainChange,
  onFiltersChange,
  onClear,
  isAgent = false,
  agentId,
}: BetListFiltersBarProps) {
  const [agentSearchQuery, setAgentSearchQuery] = useState('')
  const [playerSearchQuery, setPlayerSearchQuery] = useState('')
  // What the Player field shows: the text being typed (which is also the playerSearch filter while the
  // list is open, as before), or the label of the player picked from the list (antd showed the chosen
  // option's label).
  const [playerText, setPlayerText] = useState(filters.playerSearch ?? '')
  // The label on show after a pick, null while the field holds typed text. Read only in handlers.
  const pickedPlayerLabel = useRef<string | null>(null)
  const [datePreset, setDatePreset] = useState<BetDatePreset>('today')

  // Shown for every scheme. COMMISSION agents have sub-agents too (createAgent
  // permits COMMISSION parents and children), and gating on SHARING/CREDIT left
  // commission parents with no way to filter their sub-agents' bets.
  const agentMode = betAgentFilterMode(isAgent, agentId)
  const showAgentFilterAsSubAgents = agentMode === 'subAgents'
  const showAgentFilterAsSearch = agentMode === 'search'

  const statusOptions = useMemo(() => betStatusOptions(domain), [domain])

  const handleDateApply = (payload: DateRangeApply) => {
    if (payload.kind === 'custom') {
      setDatePreset('custom')
      onFiltersChange({ ...filters, dateFrom: payload.from, dateTo: payload.to })
      return
    }
    if (!isBetDatePreset(payload.preset)) return
    setDatePreset(payload.preset)
    if (payload.preset !== 'custom') {
      const { from, to } = getBetRangeForPreset(payload.preset)
      onFiltersChange({ ...filters, dateFrom: from, dateTo: to })
    }
  }
  // The panel's Reset returns to the default, Today.
  const handleDateReset = () => {
    setDatePreset('today')
    const { from, to } = getBetRangeForPreset('today')
    onFiltersChange({ ...filters, dateFrom: from, dateTo: to })
  }

  const shouldFetchAgents = showAgentFilterAsSearch && agentSearchQuery.trim().length >= 2
  const { data: agentsData, loading: agentsLoading } = useQuery(AGENTS_FOR_BET_FILTER_QUERY, {
    variables: { query: agentSearchQuery.trim() || undefined, limit: 50 },
    skip: !shouldFetchAgents,
    fetchPolicy: 'cache-and-network',
  })

  const { data: subAgentsData, loading: subAgentsLoading } = useQuery(
    SUB_AGENTS_FOR_BET_FILTER_QUERY,
    {
      variables: { parentAgentId: agentId!, limit: 500 },
      skip: !showAgentFilterAsSubAgents || !agentId,
      fetchPolicy: 'cache-and-network',
    }
  )

  const shouldFetchPlayers = playerSearchQuery.trim().length >= 2
  const { data: playersData, loading: playersLoading } = useQuery(PLAYERS_FOR_BET_FILTER_QUERY, {
    variables: {
      query: playerSearchQuery.trim() || undefined,
      limit: 50,
      // For agent logins, backend already scopes usersPage to full drilldown via auth context.
      // Passing agentId here would incorrectly force only direct players.
      agentId: undefined,
    },
    skip: !shouldFetchPlayers,
    fetchPolicy: 'cache-and-network',
  })

  const agentOptions = useMemo(() => {
    const items: BetAgentRow[] = showAgentFilterAsSubAgents
      ? (subAgentsData?.agents?.agentsPage?.items ?? [])
      : (agentsData?.agents?.agentsPage?.items ?? [])
    return betAgentOptions(agentMode, items)
  }, [agentMode, showAgentFilterAsSubAgents, agentsData, subAgentsData])

  const playerOptions = useMemo(() => {
    const players: BetPlayerRow[] = playersData?.usersPage?.items ?? []
    return betPlayerOptions(players)
  }, [playersData])

  const showWalletFilter = showsBetWalletFilter(domain)
  const activeFiltersCount = countActiveBetFilters(filters, datePreset)

  // Typing searches players and, as before (antd onSearch), the typed text is itself the playerSearch
  // filter. An edit of a picked player's label starts a fresh search from what it inserted, as antd's
  // empty search box did; the field's clear button arrives here as ''.
  const handlePlayerInput = (text: string) => {
    const picked = pickedPlayerLabel.current
    const search = picked === null ? text : betPlayerTextAfterPick(picked, text)
    pickedPlayerLabel.current = null
    setPlayerText(search)
    setPlayerSearchQuery(search)
    onFiltersChange({ ...filters, playerSearch: search.trim() || undefined })
  }
  // Picking a player filters by its username; re-picking the player already in force changes nothing.
  // The search text stays, so the list still holds the picked player (antd cleared it silently).
  const handlePlayerSelect = (value: string, option: ListboxOption) => {
    pickedPlayerLabel.current = option.label
    setPlayerText(option.label)
    if (value !== filters.playerSearch) onFiltersChange({ ...filters, playerSearch: value })
  }
  // antd emptied its search whenever the list closed without a pick (blur, Escape, Enter with nothing
  // to pick), and onSearch('') then dropped the typed text and the playerSearch filter. The field's text is
  // controlled, so the kit does not report that; the page does it on the same events.
  const dropTypedPlayerText = () => {
    if (pickedPlayerLabel.current === null && playerText !== '') handlePlayerInput('')
  }
  // Runs before the kit's own key handling, which then closes the list.
  const handlePlayerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const firstPlayer = playerOptions.find((option) => !option.disabled)
    const action = betSearchKeyAction(event.key, event.altKey, {
      ...listStateOf(event.currentTarget),
      hasOptions: firstPlayer !== undefined,
      showingPick: pickedPlayerLabel.current !== null,
    })
    if (action === 'pickFirst' && firstPlayer) handlePlayerSelect(firstPlayer.value, firstPlayer)
    else if (action === 'drop') dropTypedPlayerText()
  }
  // The admin agent search has the same late server list: Enter or Tab picks its first agent, as antd's
  // did. Sub-agents are listed before any typing, so the kit's own highlight already covers them.
  const handleAgentKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showAgentFilterAsSearch) return
    const firstAgent = agentOptions.find((option) => !option.disabled)
    const action = betSearchKeyAction(event.key, event.altKey, {
      ...listStateOf(event.currentTarget),
      hasOptions: firstAgent !== undefined,
      showingPick: false,
    })
    if (action === 'pickFirst' && firstAgent && firstAgent.value !== filters.agentUsername) {
      onFiltersChange({ ...filters, agentUsername: firstAgent.value })
    }
  }

  const handleClearAll = () => {
    setDatePreset('today')
    pickedPlayerLabel.current = null
    setPlayerText('')
    onClear()
  }

  return (
    <FilterBar
      label={FILTERS_LABEL}
      activeCount={activeFiltersCount}
      onClearAll={handleClearAll}
      search={(
        <SearchField
          label="Search bets"
          placeholder="Search"
          size="sm"
          value={filters.search ?? ''}
          onChange={(value) => onFiltersChange({ ...filters, search: value || undefined })}
        />
      )}
    >
      <Select
        label="Domain"
        hideLabel
        size="sm"
        className={styles.domainField}
        value={domain}
        options={BET_DOMAIN_OPTIONS}
        onChange={(value) => {
          if (isBetDomain(value)) onDomainChange(value)
        }}
      />
      <MultiSelect
        label="Status"
        hideLabel
        size="sm"
        className={styles.statusField}
        placeholder="Status"
        clearable
        maxTagCount={1}
        options={statusOptions}
        value={filters.status ?? []}
        onChange={(values) => onFiltersChange({ ...filters, status: values })}
      />
      {showWalletFilter ? (
        <Combobox
          label="Wallet"
          hideLabel
          size="sm"
          className={styles.walletField}
          placeholder="Wallet"
          searchable={false}
          clearable
          options={BET_WALLET_OPTIONS}
          value={filters.walletType ?? null}
          onChange={(value) => onFiltersChange({ ...filters, walletType: value ?? undefined })}
        />
      ) : null}
      <DateRangeField
        label="Date range"
        presets={BET_DATE_PRESETS}
        appliedPreset={datePreset}
        appliedFrom={filters.dateFrom}
        appliedTo={filters.dateTo}
        onApply={handleDateApply}
        onReset={handleDateReset}
      />
      {agentMode !== 'none' ? (
        <Combobox
          label="Agent"
          hideLabel
          size="sm"
          className={styles.agentField}
          placeholder={showAgentFilterAsSubAgents ? 'Agent' : 'Agent (search)'}
          // "All my players" is the sub-agent list's empty choice, so only a real agent offers a clear.
          clearable={Boolean(filters.agentUsername)}
          options={agentOptions}
          // Sub-agents filter on their label as typed; the admin list is searched on the server.
          filter={showAgentFilterAsSubAgents ? undefined : false}
          onInputChange={showAgentFilterAsSearch ? setAgentSearchQuery : undefined}
          onKeyDown={handleAgentKeyDown}
          loading={showAgentFilterAsSubAgents ? subAgentsLoading : agentsLoading}
          loadingText="Loading..."
          emptyText={betAgentEmptyText(
            agentMode,
            showAgentFilterAsSubAgents ? subAgentsLoading : agentsLoading,
            agentSearchQuery,
          )}
          value={filters.agentUsername ?? (showAgentFilterAsSubAgents ? '' : null)}
          onChange={(value) => onFiltersChange({
            ...filters,
            agentUsername: value === '' || value == null ? undefined : value,
          })}
        />
      ) : null}
      <Combobox
        label="Player"
        hideLabel
        size="sm"
        className={styles.playerField}
        placeholder={isAgent ? 'Player' : 'Player (search)'}
        clearable
        options={playerOptions}
        filter={false}
        // antd Select made the first suggestion active as you typed, so Enter picks it (players that
        // arrive after the typing are picked by handlePlayerKeyDown).
        autoHighlight
        value={null}
        inputValue={playerText}
        onInputChange={handlePlayerInput}
        onSelect={handlePlayerSelect}
        onKeyDown={handlePlayerKeyDown}
        onBlur={dropTypedPlayerText}
        loading={playersLoading}
        loadingText="Loading..."
        emptyText={betPlayerEmptyText(playersLoading, playerSearchQuery)}
      />
    </FilterBar>
  )
}
