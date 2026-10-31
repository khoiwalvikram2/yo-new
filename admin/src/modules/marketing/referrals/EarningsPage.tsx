import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { useQuery, useLazyQuery, gql } from '@apollo/client'
import { IconCoins, IconCurrencyDollar, IconList, IconReceipt, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Card } from '@/ui/components/Card'
import { Combobox } from '@/ui/components/Combobox'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { IconButton } from '@/ui/components/IconButton'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import {
  EARNINGS_DATE_PRESETS,
  EARNINGS_PAGE_SIZE,
  EARNINGS_PAGE_SIZE_OPTIONS,
  MIN_SEARCH_LEN,
  RULE_TYPE_FILTER_OPTIONS,
  SEARCH_DEBOUNCE_MS,
  TIER_FILTER_OPTIONS,
  applyColumnFilters,
  columnFilterCount,
  displayedEarnings,
  earningsDatePreset,
  earningsEmptyTitle,
  earningsFilterCount,
  earningsQueryVariables,
  earningsTotalLabel,
  earningsTotals,
  hasEarningsFilters,
  mergeRefereeOptions,
  mergeReferrerOptions,
  pageOf,
  refereeEmptyText,
  refereeLoading,
  refereePlaceholder,
  referrerEmptyText,
  ruleTypeText,
  searchKeyAction,
  sortEarnings,
  tierText,
  userToOption,
  type EarningsFilters,
  type ReferralEarning,
  type UserOption,
} from './referralEarningsModel'
import styles from './EarningsPage.module.css'

const REFERRAL_EARNINGS_QUERY = gql`
  query ReferralEarnings($referrerId: ID, $refereeId: ID, $ruleType: String, $tier: Int, $fromDate: String, $toDate: String) {
    referralEarnings(
      referrerId: $referrerId
      refereeId: $refereeId
      ruleType: $ruleType
      tier: $tier
      fromDate: $fromDate
      toDate: $toDate
    ) {
      id
      referrerId
      refereeId
      referrerName
      referrerPhone
      refereeName
      refereePhone
      tier
      ruleType
      grossAmount
      netAmount
      currency
      calculatedAt
    }
  }
`

const USERS_SEARCH_QUERY = gql`
  query UsersSearch($query: String) {
    users(query: $query) {
      id
      name
      phone
    }
  }
`

const REFERRAL_REFEREES_QUERY = gql`
  query ReferralReferees($referrerId: ID!, $query: String) {
    referralReferees(referrerId: $referrerId, query: $query) {
      id
      name
      phone
    }
  }
`

const REFERRAL_ATTRIBUTION_QUERY = gql`
  query ReferralAttribution($refereeId: ID!) {
    referralAttribution(refereeId: $refereeId) {
      referrerId
      refereeId
    }
  }
`

const USER_BY_ID_QUERY = gql`
  query UserById($id: ID!) {
    user(id: $id) {
      id
      name
      phone
    }
  }
`

interface PersonRow {
  id: string | number
  name: string | null
  phone: string | null
}

interface ReferralEarningsData {
  referralEarnings: ReferralEarning[] | null
}

interface UsersSearchData {
  users: PersonRow[] | null
}

interface ReferralRefereesData {
  referralReferees: PersonRow[] | null
}

interface ReferralAttributionData {
  referralAttribution: { referrerId: string | number | null; refereeId: string | number | null } | null
}

interface UserByIdData {
  user: PersonRow | null
}

// The legacy phone layout titled this block "Filters"; it also names the compact trigger, and a longer
// name overflows the compact row at 375px (Task 101).
const FILTERS_LABEL = 'Filters'

/** The open state of a kit Combobox, as its input exposes it to a key handler. */
function listStateOf(input: HTMLInputElement) {
  return {
    listOpen: input.getAttribute('aria-expanded') === 'true',
    optionActive: input.hasAttribute('aria-activedescendant'),
  }
}

export default function EarningsPage() {
  return (
    <RBACGuard required={[{ domain: 'referrals.earnings', actions: ['view'] }]}>
      <EarningsPageContent />
    </RBACGuard>
  )
}

function EarningsPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const [filters, setFilters] = useState<EarningsFilters>({})

  const [referrerSearch, setReferrerSearch] = useState('')
  const [refereeSearch, setRefereeSearch] = useState('')
  const [referrerOptions, setReferrerOptions] = useState<UserOption[]>([])
  const [refereeOptions, setRefereeOptions] = useState<UserOption[]>([])
  const [referrerOptionFromReferee, setReferrerOptionFromReferee] = useState<UserOption | null>(null)
  const [selectedReferrerOption, setSelectedReferrerOption] = useState<UserOption | null>(null)
  const [selectedRefereeOption, setSelectedRefereeOption] = useState<UserOption | null>(null)
  const lastAttributionRefereeIdRef = useRef<string | null>(null)
  const lastRefereeLoadReferrerIdRef = useRef<string | null>(null)

  // The table's own state. antd kept these inside its Table; the two column filters now sit in the filter
  // bar (D5), and an empty result resets the page as the unmounted antd table did.
  const [tierFilter, setTierFilter] = useState<string[]>([])
  const [ruleTypeFilter, setRuleTypeFilter] = useState<string[]>([])
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(EARNINGS_PAGE_SIZE)
  // The error notice can be closed, as the antd Alert could; a new error shows again.
  const [dismissedError, setDismissedError] = useState<unknown>(null)

  const [searchUsers, { data: usersSearchData, loading: usersSearchLoading }] = useLazyQuery<UsersSearchData>(USERS_SEARCH_QUERY, { errorPolicy: 'all' })
  const [searchReferees, { data: refereesData, loading: refereesLoading }] = useLazyQuery<ReferralRefereesData>(REFERRAL_REFEREES_QUERY, { errorPolicy: 'all' })
  const [fetchAttribution, { data: attributionData }] = useLazyQuery<ReferralAttributionData>(REFERRAL_ATTRIBUTION_QUERY, { errorPolicy: 'all' })
  const [fetchUserById, { data: userByIdData }] = useLazyQuery<UserByIdData>(USER_BY_ID_QUERY, { errorPolicy: 'all' })

  const queryVariables = earningsQueryVariables(filters)

  const { data, loading, error: earningsError } = useQuery<ReferralEarningsData>(REFERRAL_EARNINGS_QUERY, {
    variables: queryVariables,
    errorPolicy: 'all',
  })

  /* The lazy-query functions are stable (Apollo's useLazyQuery returns one memoised execute), so listing
     them below changes nothing about when these effects run. */

  // Debounced referrer search
  useEffect(() => {
    if (!referrerSearch.trim() || referrerSearch.trim().length < MIN_SEARCH_LEN) {
      setReferrerOptions([])
      return
    }
    const t = setTimeout(() => {
      searchUsers({ variables: { query: referrerSearch.trim() } })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [referrerSearch, searchUsers])

  useEffect(() => {
    if (!usersSearchData?.users) return
    setReferrerOptions(usersSearchData.users.map((u) => userToOption({ id: u.id, name: u.name, phone: u.phone })))
  }, [usersSearchData])

  // Referee options: when user types, search; when search cleared and referrer set, reload full referee list (once per referrer to avoid duplicate calls)
  useEffect(() => {
    if (refereeSearch.trim().length < MIN_SEARCH_LEN) {
      if (!filters.referrerId) {
        lastRefereeLoadReferrerIdRef.current = null
        setRefereeOptions([])
        return
      }
      if (lastRefereeLoadReferrerIdRef.current === filters.referrerId) return
      lastRefereeLoadReferrerIdRef.current = filters.referrerId
      searchReferees({ variables: { referrerId: filters.referrerId, query: undefined } })
      return
    }
    lastRefereeLoadReferrerIdRef.current = null
    const t = setTimeout(() => {
      if (filters.referrerId) {
        searchReferees({ variables: { referrerId: filters.referrerId, query: refereeSearch.trim() } })
      } else {
        searchUsers({ variables: { query: refereeSearch.trim() } })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [refereeSearch, filters.referrerId, searchReferees, searchUsers])

  useEffect(() => {
    if (filters.referrerId && refereesData?.referralReferees) {
      setRefereeOptions(refereesData.referralReferees.map((u) => userToOption({ id: u.id, name: u.name, phone: u.phone })))
    } else if (!filters.referrerId && usersSearchData?.users && refereeSearch.trim().length >= MIN_SEARCH_LEN) {
      setRefereeOptions(usersSearchData.users.map((u) => userToOption({ id: u.id, name: u.name, phone: u.phone })))
    }
  }, [refereesData, usersSearchData, filters.referrerId, refereeSearch])

  // Referee selected -> fetch attribution and referrer, then show referrer (or clear referrer if no attribution)
  useEffect(() => {
    if (!attributionData) return
    const requestedRefereeId = lastAttributionRefereeIdRef.current
    if (attributionData.referralAttribution == null) {
      if (requestedRefereeId && filters.refereeId === requestedRefereeId) {
        setReferrerOptionFromReferee(null)
        setSelectedReferrerOption(null)
        setFilters((prev) => ({ ...prev, referrerId: undefined }))
      }
      return
    }
    if (!attributionData.referralAttribution.referrerId) return
    const referrerId = String(attributionData.referralAttribution.referrerId)
    fetchUserById({ variables: { id: referrerId } })
  }, [attributionData, filters.refereeId, fetchUserById])

  // Apply referrer when we have user + attribution; run when refereeId changes too so that after Clear All, re-selecting referee re-applies cached data
  useEffect(() => {
    if (!userByIdData?.user || !attributionData?.referralAttribution) return
    const u = userByIdData.user
    const referrerId = String(attributionData.referralAttribution.referrerId)
    const refereeId = attributionData.referralAttribution.refereeId != null ? String(attributionData.referralAttribution.refereeId) : null
    if (String(u.id) !== referrerId) return
    if (refereeId != null && filters.refereeId !== refereeId) return
    const opt = userToOption({ id: u.id, name: u.name, phone: u.phone })
    setReferrerOptionFromReferee(opt)
    setFilters((prev) => ({ ...prev, referrerId: String(u.id) }))
  }, [userByIdData, attributionData, filters.refereeId])

  const referrerSelectOptions = useMemo(
    () => mergeReferrerOptions(selectedReferrerOption, referrerOptionFromReferee, referrerOptions),
    [selectedReferrerOption, referrerOptionFromReferee, referrerOptions],
  )

  const refereeSelectOptions = useMemo(
    () => mergeRefereeOptions(selectedRefereeOption, refereeOptions),
    [selectedRefereeOption, refereeOptions],
  )

  const handleClearFilters = () => {
    setFilters({})
    setReferrerOptions([])
    setRefereeOptions([])
    setReferrerOptionFromReferee(null)
    setSelectedReferrerOption(null)
    setSelectedRefereeOption(null)
    lastAttributionRefereeIdRef.current = null
    lastRefereeLoadReferrerIdRef.current = null
    setReferrerSearch('')
    setRefereeSearch('')
  }

  const onReferrerChange = (value: string | undefined, option?: unknown) => {
    setReferrerOptionFromReferee(null)
    lastRefereeLoadReferrerIdRef.current = null
    if (value && option && typeof option === 'object' && option !== null && 'value' in option && 'label' in option) {
      const opt = option as { value: string; label: string }
      setSelectedReferrerOption({ value: opt.value, label: opt.label })
    } else {
      setSelectedReferrerOption(null)
    }
    setFilters((prev) => ({ ...prev, referrerId: value, refereeId: undefined }))
    setRefereeOptions([])
    setSelectedRefereeOption(null)
    setRefereeSearch('')
  }

  const onRefereeChange = (value: string | undefined, option?: unknown) => {
    if (value && option && typeof option === 'object' && option !== null && 'value' in option && 'label' in option) {
      const opt = option as { value: string; label: string }
      setSelectedRefereeOption({ value: opt.value, label: opt.label })
    } else {
      setSelectedRefereeOption(null)
    }
    setFilters((prev) => ({ ...prev, refereeId: value }))
    if (!value) {
      lastAttributionRefereeIdRef.current = null
      return
    }
    lastAttributionRefereeIdRef.current = value
    fetchAttribution({ variables: { refereeId: value } })
  }

  /* antd made the first option active whenever a search's results arrived, so Enter or Tab took the first
     person; the kit highlights while typing, before the debounced results land. This runs before the
     field's own key handling, which then closes the list. */
  const pickFirstOnKey = (
    event: KeyboardEvent<HTMLInputElement>,
    options: readonly UserOption[],
    current: string | undefined,
    choose: (value: string, option: UserOption) => void,
  ) => {
    const first = options[0]
    const action = searchKeyAction(event.key, { ...listStateOf(event.currentTarget), hasOptions: first !== undefined })
    if (action === 'pickFirst' && first && first.value !== current) choose(first.value, first)
  }

  const applyDateRange = (payload: DateRangeApply) => {
    if (payload.kind === 'custom') {
      setFilters({ ...filters, dateRange: { from: payload.from, to: payload.to } })
      return
    }
    // "All dates" is the cleared picker: no date filter at all.
    setFilters({ ...filters, dateRange: undefined })
  }

  const handleClearAll = () => {
    handleClearFilters()
    setTierFilter([])
    setRuleTypeFilter([])
    setPage(1)
  }

  const columns: DataTableColumn<ReferralEarning>[] = [
    {
      key: 'referrer',
      header: 'Referrer',
      sort: true,
      cell: (record) => (
        <div className={styles.person}>
          <span className={styles.personName}>{record.referrerName ?? '—'}</span>
          <span className={styles.personPhone}>{record.referrerPhone ?? '—'}</span>
          <span className={styles.personId}>ID: {record.referrerId}</span>
        </div>
      ),
    },
    {
      key: 'referee',
      header: 'Referee',
      sort: true,
      cell: (record) => (
        <div className={styles.person}>
          <span className={styles.personName}>{record.refereeName ?? '—'}</span>
          <span className={styles.personPhone}>{record.refereePhone ?? '—'}</span>
          <span className={styles.personId}>ID: {record.refereeId}</span>
        </div>
      ),
    },
    {
      key: 'tier',
      header: 'Tier',
      sort: true,
      cell: (record) => (record.tier != null
        ? <span className={clsx(styles.tag, styles.hueVio)}>{tierText(record.tier)}</span>
        : '—'),
    },
    {
      key: 'ruleType',
      header: 'Rule Type',
      cell: (record) => (record.ruleType
        ? <span className={clsx(styles.tag, styles.hueBlu)}>{ruleTypeText(record.ruleType)}</span>
        : '—'),
    },
    {
      key: 'grossAmount',
      header: 'Gross Amount',
      align: 'right',
      sort: true,
      cell: (record) => formatAmount(Number(record.grossAmount) || 0, record.currency || 'INR'),
    },
    {
      key: 'netAmount',
      header: 'Net Amount',
      align: 'right',
      emphasis: 'key',
      sort: true,
      cell: (record) => formatAmount(Number(record.netAmount) || 0, record.currency || 'INR'),
    },
    {
      key: 'calculatedAt',
      header: 'Date',
      sort: true,
      cell: (record) => (record.calculatedAt ? formatDateTime(record.calculatedAt, 'MMM d, yyyy HH:mm') : '—'),
    },
  ]

  const earnings = data?.referralEarnings || []
  const earningsDisplay = displayedEarnings(earnings)
  const hasFilters = hasEarningsFilters(filters)
  const filterCount = earningsFilterCount(filters)
  const columnFilters = { tiers: tierFilter, ruleTypes: ruleTypeFilter }
  const tableFiltered = columnFilterCount(columnFilters) > 0
  const tableRows = sortEarnings(applyColumnFilters(earningsDisplay, columnFilters), sort)
  const totals = earningsTotals(earningsDisplay)
  const showError = Boolean(earningsError) && earningsError !== dismissedError

  // An empty result unmounted the antd table, so the next result started on its first page.
  const emptyResult = earningsDisplay.length === 0
  useEffect(() => {
    if (emptyResult) setPage(1)
  }, [emptyResult])

  const refereeState = {
    refereesLoading,
    usersSearchLoading,
    search: refereeSearch,
    referrerId: filters.referrerId,
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Referral Earnings"
        sub="View and track all referral earnings"
        back={{ to: '/referrals', label: 'Back to Referrals' }}
      />

      <div className={styles.content}>
        {/* Filters Bar */}
        <FilterBar
          label={FILTERS_LABEL}
          activeCount={filterCount + columnFilterCount(columnFilters)}
          onClearAll={handleClearAll}
        >
          <Combobox
            label="Referrer"
            hideLabel
            size="sm"
            className={styles.personField}
            placeholder="Referrer (search name or phone)"
            clearable
            filter={false}
            options={referrerSelectOptions}
            value={filters.referrerId || null}
            onChange={(value, option) => onReferrerChange(value ?? undefined, option ?? undefined)}
            onInputChange={setReferrerSearch}
            onKeyDown={(event) => pickFirstOnKey(event, referrerSelectOptions, filters.referrerId, onReferrerChange)}
            loading={usersSearchLoading}
            emptyText={referrerEmptyText(referrerSearch)}
          />
          <Combobox
            label="Referee"
            hideLabel
            size="sm"
            className={styles.personField}
            placeholder={refereePlaceholder(filters.referrerId)}
            clearable
            filter={false}
            options={refereeSelectOptions}
            value={filters.refereeId || null}
            onChange={(value, option) => onRefereeChange(value ?? undefined, option ?? undefined)}
            onInputChange={setRefereeSearch}
            onKeyDown={(event) => pickFirstOnKey(event, refereeSelectOptions, filters.refereeId, onRefereeChange)}
            loading={refereeLoading(refereeState)}
            // antd showed an empty list while a search ran; the kit's list says so.
            emptyText={refereeEmptyText(refereeState) ?? 'Loading…'}
          />
          <Combobox
            label="Rule Type"
            hideLabel
            size="sm"
            className={styles.ruleTypeField}
            placeholder="Rule Type"
            searchable={false}
            clearable
            options={RULE_TYPE_FILTER_OPTIONS}
            value={filters.ruleType ?? null}
            onChange={(value) => setFilters({ ...filters, ruleType: value ?? undefined })}
          />
          <DateRangeField
            label="Date range"
            presets={EARNINGS_DATE_PRESETS}
            appliedPreset={earningsDatePreset(filters.dateRange)}
            appliedFrom={filters.dateRange?.from}
            appliedTo={filters.dateRange?.to}
            onApply={applyDateRange}
            onReset={() => setFilters({ ...filters, dateRange: undefined })}
          />
          {/* The legacy table's Tier and Rule Type column filters (D5): they narrow the rows on screen only. */}
          <MultiSelect
            label="Show tiers"
            hideLabel
            size="sm"
            className={styles.columnField}
            placeholder="Show tiers"
            searchable={false}
            clearable
            maxTagCount={1}
            options={TIER_FILTER_OPTIONS}
            value={tierFilter}
            onChange={(values) => {
              setTierFilter(values)
              setPage(1)
            }}
          />
          <MultiSelect
            label="Show rule types"
            hideLabel
            size="sm"
            className={styles.columnField}
            placeholder="Show rule types"
            searchable={false}
            clearable
            maxTagCount={1}
            options={RULE_TYPE_FILTER_OPTIONS}
            value={ruleTypeFilter}
            onChange={(values) => {
              setRuleTypeFilter(values)
              setPage(1)
            }}
          />
        </FilterBar>

        {showError && earningsError ? (
          <Notice
            tone="error"
            live="assertive"
            title="Could not load earnings"
            action={(
              <IconButton
                size="sm"
                label="Dismiss"
                icon={<IconX size={15} stroke={strokeFor(15)} />}
                onClick={() => setDismissedError(earningsError)}
              />
            )}
          >
            {earningsError.message}
          </Notice>
        ) : null}

        {/* Summary */}
        {earningsDisplay.length > 0 ? (
          <div className={styles.statsFrame}>
            <div className={styles.stats} role="group" aria-label="Earnings summary">
              <Stat
                label="Total Earnings"
                value={formatAmount(totals.net, totals.currency)}
                note="Net"
                icon={<IconCurrencyDollar size={18} stroke={strokeFor(18)} />}
                hue="grn"
              />
              <Stat
                label="Total Gross"
                value={formatAmount(totals.gross, totals.currency)}
                note="Gross"
                icon={<IconCoins size={18} stroke={strokeFor(18)} />}
                hue="blu"
              />
              <Stat
                label="Total Records"
                value={totals.count}
                icon={<IconList size={18} stroke={strokeFor(18)} />}
                hue="vio"
              />
            </div>
          </div>
        ) : null}

        {/* Deviation from O7: the card keeps the legacy title, which carries the count. */}
        <Card
          title={`Earnings (${earningsDisplay.length})`}
          body="table"
          tools={earningsDisplay.length > 0 ? (
            <p className={styles.cardTotal}>Total: {formatAmount(totals.net, totals.currency)}</p>
          ) : undefined}
        >
          <DataTable
            columns={columns}
            rows={pageOf(tableRows, page, pageSize)}
            rowKey={(record) => String(record.id)}
            label="Referral earnings"
            state={loading ? 'loading' : 'ready'}
            width="wide"
            sort={sort}
            onSortChange={setSort}
            empty={(
              <EmptyState
                title={earningsEmptyTitle(hasFilters || tableFiltered)}
                icon={<IconReceipt size={20} stroke={strokeFor(20)} />}
              />
            )}
            pagination={tableRows.length > 0 ? {
              current: page,
              pageSize,
              total: tableRows.length,
              onChange: setPage,
              onPageSizeChange: setPageSize,
              itemName: 'earnings',
              pageSizeOptions: EARNINGS_PAGE_SIZE_OPTIONS,
              formatSummary: ({ total }) => earningsTotalLabel(total),
              variant: 'embedded',
            } : false}
          />
        </Card>
      </div>
    </Page>
  )
}
