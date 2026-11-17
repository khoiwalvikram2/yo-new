import { Fragment, useState } from 'react'
import { useQuery } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconChevronRight } from '@tabler/icons-react'
import clsx from 'clsx'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { useAuthStore } from '@/shared/core/authStore'
import { canOpenChipProfile } from '@/shared/core/chipsPageAccess'
import {
  CHIP_DOWNLINE_QUERY,
  type ChipAccount,
  type ChipAccountType,
  type ChipDownlineData,
  type ChipDownlineVariables,
} from '@/lib/graphql/chips'
import {
  accountTypeLabel,
  chipErrorMessage,
  chipProfilePath,
  chipTone,
  isActiveStatus,
  refPnlNote,
  signedChips,
  statusWord,
  type ChipFormat,
} from './chipModel'
import { CHIP_READ_OPTIONS, useChipFormat } from './chipHooks'
import { ChipActions } from './ChipActions'
import styles from './Chips.module.css'

type TypeFilter = 'ALL' | ChipAccountType
type Step = Pick<ChipAccount, 'id' | 'username'>

const TYPE_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'AGENT', label: 'Agents' },
  { value: 'PLAYER', label: 'Players' },
] as const

const PAGE_SIZES = [20, 50, 100] as const

export interface ChipDownlineTableProps {
  /** Opens on this agent's direct downline. Without it, on the caller's own: an agent's sub-agents and
   *  players, an admin's root CREDIT agents and WHITELABEL_CREDIT players. */
  parentAgentId?: string | null
  /** After a deposit, withdrawal or credit reference change on a row (the chips reads refetch themselves). */
  onChanged?: () => void
  /** Names the table. @default 'Chip downline' */
  label?: string
  /** @default 20 */
  pageSize?: number
}

function RefPnl({ value, format }: { value: number; format: ChipFormat }) {
  const tone = chipTone(value)
  return (
    <span className={styles.stack}>
      <span className={clsx(styles.num, tone && styles[tone])}>{signedChips(value, format)}</span>
      {tone ? <span className={styles.sub}>{refPnlNote(value)}</span> : null}
    </span>
  )
}

/**
 * A direct downline on chips (spec §8): Username, Type, Credit Ref, Balance, Exposure, Available and Ref P/L,
 * a totals row, and D / W / CR / View on each row. An agent's name opens that agent's own downline; the trail
 * above the table walks back up. D / W / CR show only where the caller is the direct parent.
 */
export function ChipDownlineTable({ parentAgentId = null, onChanged, label = 'Chip downline', pageSize: initialPageSize = 20 }: ChipDownlineTableProps) {
  const { isMobile } = useBreakpoint()
  const agent = useAuthStore(s => s.agent)
  const roles = useAuthStore(s => s.roles)
  const permissions = useAuthStore(s => s.permissions)
  // An agent opens its own downline's profiles; an admin sees View only where that profile page lets it in.
  const canView = (row: ChipAccount) => Boolean(agent) || canOpenChipProfile(row.accountType, roles, permissions)
  // The trail belongs to the downline the table opened on; a new one starts at its top again.
  const [drill, setDrill] = useState<{ root: string | null; trail: Step[] }>({ root: parentAgentId, trail: [] })
  const trail = drill.root === parentAgentId ? drill.trail : []
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('ALL')
  const [pageSize, setPageSize] = useState(initialPageSize)
  const current = trail.length ? trail[trail.length - 1].id : parentAgentId
  // The page belongs to one level, search and type; any other starts again at the first page.
  const scope = JSON.stringify([current, query, type])
  const [paging, setPaging] = useState({ scope, page: 1 })
  const page = paging.scope === scope ? paging.page : 1

  const { data, previousData, loading, error, refetch } = useQuery<ChipDownlineData, ChipDownlineVariables>(CHIP_DOWNLINE_QUERY, {
    ...CHIP_READ_OPTIONS,
    variables: {
      parentAgentId: current,
      query: query || null,
      accountType: type === 'ALL' ? null : type,
      offset: (page - 1) * pageSize,
      limit: pageSize,
    },
  })
  const downline = (data ?? previousData)?.agents?.chipDownline ?? null
  const rows = downline?.items ?? []
  const totals = rows.length ? downline?.totals ?? null : null
  const format = useChipFormat(downline?.parent?.currency ?? downline?.pool?.currency ?? rows[0]?.currency)
  const state = error && !downline ? 'error' : loading ? 'loading' : 'ready'
  const filtered = Boolean(query) || type !== 'ALL'

  // A search belongs to one level, so moving along the trail clears it.
  const goTo = (depth: number) => {
    setDrill({ root: parentAgentId, trail: trail.slice(0, depth) })
    setSearchText('')
    setQuery('')
  }
  const openDownline = (account: ChipAccount) => {
    setDrill({ root: parentAgentId, trail: [...trail, { id: account.id, username: account.username }] })
    setSearchText('')
    setQuery('')
  }

  const money = (value: number) => <span className={styles.num}>{format(value)}</span>

  const columns: DataTableColumn<ChipAccount>[] = [
    {
      key: 'username',
      header: 'Username',
      cell: (row) => (
        <span className={styles.who}>
          <span className={styles.whoTop}>
            {row.accountType === 'AGENT' && row.downlineCount > 0 ? (
              <button type="button" className={styles.drill} onClick={() => openDownline(row)} aria-label={`Open ${row.username}'s downline`}>
                {row.username}
                <IconChevronRight size={14} stroke={strokeFor(14)} aria-hidden />
              </button>
            ) : (
              <span>{row.username}</span>
            )}
            {isActiveStatus(row.status) ? null : <StatusPill status={row.status ?? ''}>{statusWord(row.status)}</StatusPill>}
          </span>
          {row.name ? <span className={styles.sub}>{row.name}</span> : null}
        </span>
      ),
      footer: totals ? <b>Total</b> : undefined,
    },
    {
      key: 'type',
      header: 'Type',
      hidden: isMobile,
      cell: (row) => (
        <span className={styles.stack}>
          <span>{accountTypeLabel(row)}</span>
          {row.accountType === 'AGENT' ? <span className={styles.sub}>{`${row.downlineCount} in downline`}</span> : null}
        </span>
      ),
      footer: totals ? <span className={styles.dim}>{`${downline?.total ?? rows.length} accounts`}</span> : undefined,
    },
    { key: 'creditReference', header: 'Credit Ref', align: 'right', hidden: isMobile, cell: (row) => money(row.creditReference), footer: totals ? money(totals.creditReference) : undefined },
    { key: 'balance', header: 'Balance', align: 'right', cell: (row) => money(row.balance), footer: totals ? money(totals.balance) : undefined },
    { key: 'exposure', header: 'Exposure', align: 'right', hidden: isMobile, cell: (row) => money(row.exposure), footer: totals ? money(totals.exposure) : undefined },
    { key: 'available', header: 'Available', align: 'right', hidden: isMobile, cell: (row) => money(row.available), footer: totals ? money(totals.available) : undefined },
    {
      key: 'refPnl',
      header: 'Ref P/L',
      align: 'right',
      cell: (row) => <RefPnl value={row.refPnl} format={format} />,
      footer: totals ? <RefPnl value={totals.refPnl} format={format} /> : undefined,
    },
  ]

  const parent = downline?.parent ?? null
  const parentTone = parent ? chipTone(parent.refPnl) : undefined
  const pool = downline?.pool ?? null

  return (
    <div>
      <div className={styles.toolbar}>
        {trail.length ? (
          <nav className={styles.trail} aria-label="Downline trail">
            <Button variant="link" size="sm" onClick={() => goTo(0)}>
              Downline
            </Button>
            {trail.map((step, index) => (
              <Fragment key={step.id}>
                <IconChevronRight size={14} stroke={strokeFor(14)} aria-hidden />
                {index === trail.length - 1 ? (
                  <span aria-current="page">{step.username}</span>
                ) : (
                  <Button variant="link" size="sm" onClick={() => goTo(index + 1)}>
                    {step.username}
                  </Button>
                )}
              </Fragment>
            ))}
          </nav>
        ) : null}
        {parent ? (
          <p className={styles.parentLine}>
            {`${parent.username}: balance `}
            <b>{format(parent.balance)}</b>
            {' · downline '}
            <b>{format(parent.downlineBalance)}</b>
            {' · Ref P/L '}
            <b className={clsx(parentTone && styles[parentTone])}>{signedChips(parent.refPnl, format)}</b>
          </p>
        ) : pool ? (
          <p className={styles.parentLine}>
            {'Whitelabel pool: available '}
            <b>{format(pool.available)}</b>
          </p>
        ) : null}
        <FilterBar
          label="Downline filters"
          activeCount={(query ? 1 : 0) + (type !== 'ALL' ? 1 : 0)}
          onClearAll={() => {
            setSearchText('')
            setQuery('')
            setType('ALL')
          }}
          search={
            <SearchField
              label="Search the downline"
              hideLabel
              size="sm"
              value={searchText}
              onChange={setSearchText}
              onSubmit={(value) => setQuery(value.trim())}
            />
          }
          summary={downline ? <><b>{downline.total}</b> accounts</> : undefined}
        >
          <SegmentedControl
            label="Account type"
            size="sm"
            value={type}
            options={TYPE_OPTIONS}
            onChange={setType}
          />
        </FilterBar>
      </div>
      <DataTable
        label={label}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.accountType}:${row.id}`}
        state={state}
        error={chipErrorMessage(error, 'The downline could not be loaded.')}
        onRetry={() => void refetch()}
        empty={
          <EmptyState
            title={filtered ? 'No accounts match' : 'No downline yet'}
            description={filtered ? 'Try another name or account type.' : 'Sub-agents and players on chips appear here.'}
          />
        }
        rowActions={(row) => ({
          primary: (
            <span className={styles.rowActions}>
              <ChipActions account={row} onDone={onChanged} />
              {canView(row) ? (
                <Link to={chipProfilePath(row)} className={buttonClassName({ size: 'xs' })} aria-label={`View ${row.username}`}>
                  View
                </Link>
              ) : null}
            </span>
          ),
        })}
        pagination={{
          current: page,
          pageSize,
          total: downline?.total ?? 0,
          loading: loading && Boolean(downline),
          itemName: 'accounts',
          pageSizeOptions: PAGE_SIZES,
          onChange: (next) => setPaging({ scope, page: next }),
          onPageSizeChange: (size) => {
            setPageSize(size)
            setPaging({ scope, page: 1 })
          },
        }}
      />
    </div>
  )
}
