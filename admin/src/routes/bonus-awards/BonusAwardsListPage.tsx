import { useState, useMemo, useEffect, useCallback, useId, useRef, type MouseEvent } from 'react'
import { useQuery, useMutation, gql, useApolloClient } from '@apollo/client'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { IconAlertTriangle, IconChevronDown, IconInbox, IconRefresh } from '@tabler/icons-react'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { deriveAgentPermissionsFromDomains } from '@/shared/core/agentDerivedPermissions'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { formatDate as formatDateInTz, formatTime as formatTimeInTz } from '@/shared/services/formatting'
import { useAuthStore } from '@/shared/core/authStore'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { Menu, MenuItem } from '@/ui/components/Menu'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import {
  BONUS_AWARDS_PAGE_QUERY,
  SET_BONUS_AWARD_STATUS_MUTATION,
  ACTIVATE_BONUS_AWARD_ADMIN_MUTATION,
  SWITCH_BONUS_AWARD_ADMIN_MUTATION,
  FORFEIT_BONUS_AWARD_ADMIN_MUTATION,
  type BonusAwardsPageFiltersInput,
} from '@/lib/graphql/bonusAwardsPage'
import { BonusAwardsFiltersBar } from './components/BonusAwardsFiltersBar'
import { BonusAwardsStatsCards } from './components/BonusAwardsStatsCards'
import {
  REMARK_LABEL,
  REMARK_MAX_LENGTH,
  REMARK_PLACEHOLDER,
  REMARK_REQUIRED_MESSAGE,
  REMARK_REQUIRED_TITLE,
  SWITCH_BONUS_WARNING,
  bonusAwardPlayerContact,
  bonusAwardPlayerName,
  bonusAwardRowActionKind,
  bonusAwardStatusLabel,
  bonusRemarkModalMeta,
  buildBonusAwardsFiltersPayload,
  clampBonusAwardsOffset,
  formatWageringPair,
  initialBonusAwardsFilters,
  requestErrorMessage,
  resolveBonusRemarkOutcome,
  toCampaignOptions,
  wageringProgressPercent,
  type BonusAwardMutationPayload,
  type BonusAwardRow,
  type BonusAwardsListFiltersState,
  type BonusRemarkModalState,
} from './bonusAwardsModel'
import styles from './BonusAwardsListPage.module.css'

const BONUS_CAMPAIGNS_MINIMAL_QUERY = gql`
  query BonusCampaignsForAwardsFilter {
    bonusCampaigns {
      id
      name
    }
  }
`

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
/* antd's notification stayed 4.5 seconds; the kit toast keeps that timing, as Create Bonus does. */
const NOTIFICATION_DURATION_MS = 4500
const ROW_ICON = 13

/** A date over its time, the legacy `dd MMM yy` / `HH:mm:ss` pair. */
function DateTimeCell({
  value,
  formatDate,
  formatTime,
}: {
  value: string
  formatDate: (date: string | Date, formatStr?: string) => string
  formatTime: (date: string | Date, formatStr?: string) => string
}) {
  return (
    <time dateTime={value} className={styles.stack}>
      <span>{formatDate(value, 'dd MMM yy')}</span>
      <span className={styles.secondary}>{formatTime(value, 'HH:mm:ss')}</span>
    </time>
  )
}

export default function BonusAwardsListPage() {
  return (
    <RBACGuard required={[{ domain: 'bonuses.list', actions: ['view'] }]}>
      <BonusAwardsListContent />
    </RBACGuard>
  )
}

function BonusAwardsListContent() {
  const client = useApolloClient()
  const agent = useAuthStore((s) => s.agent)
  const adminPermissions = useAuthStore((s) => s.permissions)
  const isAgent = !!agent
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  const formatDate = useCallback(
    (date: string | Date, formatStr?: string) => formatDateInTz(date, DEFAULT_ADMIN_TZ, formatStr),
    [],
  )
  const formatTime = useCallback(
    (date: string | Date, formatStr?: string) => formatTimeInTz(date, DEFAULT_ADMIN_TZ, formatStr),
    [],
  )

  const effectivePermissions = useMemo(() => {
    if (isAgent) return deriveAgentPermissionsFromDomains(agent?.allowedDomains)
    return adminPermissions ?? []
  }, [isAgent, agent?.allowedDomains, adminPermissions])

  const canChangePendingBonusStatus = useMemo(
    () =>
      hasPermissionWithNested(effectivePermissions, 'players.bonuses', 'delete') ||
      hasPermissionWithNested(effectivePermissions, 'bonuses.detail', 'update'),
    [effectivePermissions],
  )

  const [remarkModal, setRemarkModal] = useState<BonusRemarkModalState | null>(null)
  const [remarkDraft, setRemarkDraft] = useState('')
  const [remarkSubmitLoading, setRemarkSubmitLoading] = useState(false)
  const remarkFieldRef = useRef<HTMLElement | null>(null)
  const remarkReasonId = useId()
  /* The row control that opened the remark dialog gets focus back when it closes. The Set status menu item
     that opens it is unmounted with the menu in the same commit, so the dialog cannot fall back on it. */
  const actionTriggerRef = useRef<HTMLElement | null>(null)
  const rememberActionTrigger = useCallback((event: MouseEvent<HTMLElement>) => {
    actionTriggerRef.current = event.currentTarget
  }, [])

  const [listFilters, setListFilters] = useState<BonusAwardsListFiltersState>(() => initialBonusAwardsFilters())
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(50)

  const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1

  const filtersPayload = useMemo(
    (): BonusAwardsPageFiltersInput => buildBonusAwardsFiltersPayload(listFilters, isAgent),
    [listFilters, isAgent],
  )

  useEffect(() => {
    setOffset(0)
  }, [listFilters])

  const variables = useMemo(
    () => ({
      filters: filtersPayload,
      offset,
      limit,
    }),
    [filtersPayload, offset, limit],
  )

  const {
    data: campaignsData,
    loading: campaignsLoading,
    refetch: refetchCampaigns,
  } = useQuery(BONUS_CAMPAIGNS_MINIMAL_QUERY, {
    skip: isAgent,
    fetchPolicy: 'cache-first',
    errorPolicy: 'all',
  })

  const { data, previousData, loading, error, refetch } = useQuery(BONUS_AWARDS_PAGE_QUERY, {
    variables,
    fetchPolicy: 'cache-and-network',
    /** So Refresh shows loading and UI updates while refetch runs (default is initial load only). */
    notifyOnNetworkStatusChange: true,
  })

  const [setBonusAwardStatus] = useMutation(SET_BONUS_AWARD_STATUS_MUTATION)
  const [activateBonusAwardAdmin] = useMutation(ACTIVATE_BONUS_AWARD_ADMIN_MUTATION)
  const [switchBonusAwardAdmin] = useMutation(SWITCH_BONUS_AWARD_ADMIN_MUTATION)
  const [forfeitBonusAwardAdmin] = useMutation(FORFEIT_BONUS_AWARD_ADMIN_MUTATION)

  const openSetStatusWithRemark = useCallback((awardId: string, nextStatus: 'cancelled' | 'expired') => {
    setRemarkDraft('')
    setRemarkModal({ mode: 'setStatus', awardId, nextStatus })
  }, [])

  const openActivateWithRemark = useCallback((row: BonusAwardRow) => {
    setRemarkDraft('')
    setRemarkModal({ mode: 'activate', row })
  }, [])

  const openForfeitWithRemark = useCallback((row: BonusAwardRow) => {
    setRemarkDraft('')
    setRemarkModal({ mode: 'forfeit', row })
  }, [])

  const remarkModalMeta = useMemo(() => (remarkModal ? bonusRemarkModalMeta(remarkModal) : null), [remarkModal])

  const handleRemarkModalSubmit = useCallback(async () => {
    if (!remarkModal) return
    const remark = remarkDraft.trim()
    if (!remark) {
      toast({
        title: REMARK_REQUIRED_TITLE,
        message: REMARK_REQUIRED_MESSAGE,
        tone: 'warn',
        duration: NOTIFICATION_DURATION_MS,
      })
      return
    }
    setRemarkSubmitLoading(true)
    try {
      let payload: BonusAwardMutationPayload | null | undefined
      if (remarkModal.mode === 'setStatus') {
        const { data: mutData } = await setBonusAwardStatus({
          variables: { awardId: remarkModal.awardId, status: remarkModal.nextStatus, remark },
          context: { skipNotification: true },
        })
        payload = mutData?.setBonusAwardStatus
      } else if (remarkModal.mode === 'activate') {
        const { data: mutData } = await activateBonusAwardAdmin({
          variables: { awardId: String(remarkModal.row.id), remark },
          context: { skipNotification: true },
        })
        payload = mutData?.activateBonusAwardAdmin
      } else if (remarkModal.mode === 'switch') {
        const { data: swData } = await switchBonusAwardAdmin({
          variables: { awardId: String(remarkModal.row.id), remark },
          context: { skipNotification: true },
        })
        payload = swData?.switchBonusAwardAdmin
      } else {
        const { data: ffData } = await forfeitBonusAwardAdmin({
          variables: { awardId: String(remarkModal.row.id), remark },
          context: { skipNotification: true },
        })
        payload = ffData?.forfeitBonusAwardAdmin
      }

      const outcome = resolveBonusRemarkOutcome(remarkModal.mode, payload)
      if (outcome.kind === 'success') {
        toast({ message: outcome.message, tone: 'ok', duration: NOTIFICATION_DURATION_MS })
        setRemarkModal(null)
        await refetch()
      } else if (outcome.kind === 'switch' && remarkModal.mode === 'activate') {
        // The remark already typed carries over into the switch dialog, as before.
        setRemarkModal({ mode: 'switch', row: remarkModal.row })
      } else if (outcome.kind === 'error') {
        toast({
          title: outcome.title,
          message: outcome.message,
          tone: 'error',
          duration: NOTIFICATION_DURATION_MS,
        })
      }
    } catch (err: unknown) {
      toast({
        title: 'Bonus card',
        message: requestErrorMessage(err, 'Request failed'),
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    } finally {
      setRemarkSubmitLoading(false)
    }
  }, [
    remarkModal,
    remarkDraft,
    setBonusAwardStatus,
    activateBonusAwardAdmin,
    switchBonusAwardAdmin,
    forfeitBonusAwardAdmin,
    refetch,
  ])

  useEffect(() => {
    if (error) {
      toast({
        title: 'Bonus cards',
        message: error.message,
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    }
  }, [error])

  const pageData = data?.bonusAwardsPage ?? { items: [], total: 0 }
  const items = (pageData.items ?? []) as BonusAwardRow[]
  const total = pageData.total ?? 0
  /* The pager and the card count read the last total the server returned, so neither unmounts (taking the
     focused Next page or Rows per page control with it) while another page or page size loads. Before any
     total has been seen (first load, or a first load that failed) there is no pager. */
  const shownPage = (data ?? previousData)?.bonusAwardsPage
  const shownTotal = shownPage?.total ?? 0

  useEffect(() => {
    /* Clamp only against a total the server returned for these variables. While another page loads there
       is no data and the total reads 0, which used to send every page change straight back to page 1. */
    if (!data) return
    const nextOffset = clampBonusAwardsOffset(total, limit, offset)
    if (nextOffset !== offset) setOffset(nextOffset)
  }, [data, total, limit, offset])

  const handleRefresh = useCallback(async () => {
    try {
      const tasks: Promise<unknown>[] = [
        refetch(),
        client.refetchQueries({ include: ['BonusAwardsPageStats', 'BonusKPIsForAwards'] }),
      ]
      if (!isAgent) {
        tasks.push(refetchCampaigns())
      }
      await Promise.all(tasks)
    } catch (err: unknown) {
      toast({
        title: 'Bonus cards',
        message: requestErrorMessage(err, 'Refresh failed'),
        tone: 'error',
        duration: NOTIFICATION_DURATION_MS,
      })
    }
  }, [client, refetch, refetchCampaigns, isAgent])

  const handleClearListFilters = useCallback(() => {
    setListFilters(initialBonusAwardsFilters())
  }, [])

  const campaignOptions = useMemo(() => toCampaignOptions(campaignsData?.bonusCampaigns), [campaignsData])

  const columns = useMemo<DataTableColumn<BonusAwardRow>[]>(
    () => [
      { key: 'id', header: 'ID', cell: (row) => row.id, emphasis: 'id' },
      {
        key: 'campaign',
        header: 'Campaign',
        cell: (row) => (
          <div className={clsx(styles.stack, styles.campaign)}>
            {isAgent ? (
              <span className={clsx(styles.campaignName, styles.clamp)}>{row.campaignName}</span>
            ) : (
              <Link to={`/bonuses/${row.campaignId}`} className={clsx(styles.link, styles.clamp)}>
                {row.campaignName}
              </Link>
            )}
            <span className={styles.secondary}>#{row.campaignId}</span>
          </div>
        ),
      },
      {
        key: 'player',
        header: 'Player',
        cell: (row) => (
          <div className={styles.stack}>
            <Link to={`/players/profile/${row.userId}`} className={clsx(styles.link, styles.playerLink)}>
              {bonusAwardPlayerName(row)}
            </Link>
            <span className={styles.secondary}>{bonusAwardPlayerContact(row)}</span>
          </div>
        ),
      },
      { key: 'domain', header: 'Domain', cell: (row) => <span className={styles.capitalize}>{row.domain}</span> },
      { key: 'type', header: 'Type', cell: (row) => row.type },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        emphasis: 'key',
        cell: (row) => formatAmount(Number(row.amount), row.currency),
      },
      {
        key: 'wagering',
        header: 'Wagering',
        align: 'right',
        cell: (row) => (
          <span className={styles.small}>{formatWageringPair(row.currentWagering, row.wageringReq)}</span>
        ),
      },
      {
        key: 'progress',
        header: 'Wagering progress',
        cell: (row) => {
          const wageringPct = wageringProgressPercent(row.currentWagering, row.wageringReq)
          if (wageringPct == null) return <span className={styles.dim}>—</span>
          return (
            <div className={styles.progress}>
              <Meter value={wageringPct} className={styles.meter} />
              <span className={styles.percent}>{`${wageringPct}%`}</span>
            </div>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        cell: (row) => <StatusPill status={row.status}>{bonusAwardStatusLabel(row.status)}</StatusPill>,
      },
      {
        key: 'changedBy',
        header: 'Changed by',
        cell: (row) => <span className={clsx(styles.actor, styles.clamp)}>{row.statusUpdatedByName || '—'}</span>,
      },
      {
        key: 'actorPhone',
        header: 'Actor phone',
        emphasis: 'dim',
        cell: (row) => row.statusUpdatedByPhone || '—',
      },
      {
        key: 'remark',
        header: 'Remark',
        cell: (row) => (
          <span className={clsx(styles.remark, styles.clamp)}>{row.statusUpdatedByRemark || '—'}</span>
        ),
      },
      {
        key: 'statusAt',
        header: 'Status at',
        cell: (row) =>
          row.statusUpdatedAt ? (
            <DateTimeCell value={row.statusUpdatedAt} formatDate={formatDate} formatTime={formatTime} />
          ) : (
            '—'
          ),
      },
      {
        key: 'awarded',
        header: 'Awarded',
        cell: (row) => <DateTimeCell value={row.awardedAt} formatDate={formatDate} formatTime={formatTime} />,
      },
      {
        key: 'expires',
        header: 'Expires',
        cell: (row) =>
          row.expiresAt ? (
            <DateTimeCell value={row.expiresAt} formatDate={formatDate} formatTime={formatTime} />
          ) : (
            <span className={styles.dim}>—</span>
          ),
      },
      {
        key: 'details',
        header: 'Details',
        cell: (row) => (
          <div className={styles.details}>
            {row.distributionType && (
              <span>
                <span className={styles.detailTerm}>Distribution:</span> {row.distributionType}
              </span>
            )}
            {row.triggerAmount != null && (
              <span>
                <span className={styles.detailTerm}>Trigger:</span>{' '}
                {formatAmount(Number(row.triggerAmount), row.currency)}
              </span>
            )}
            {row.firstDepositRequired === true && (
              <span className={styles.firstDeposit}>
                First deposit
                {row.firstDepositUnlocked ? ' (unlocked)' : ' (locked)'}
              </span>
            )}
            {row.completedAt && (
              <span className={styles.dim}>Done {formatDate(row.completedAt, 'dd MMM yy')}</span>
            )}
          </div>
        ),
      },
    ],
    [formatAmount, formatDate, formatTime, isAgent],
  )

  /* Pending cards offer Activate and the Set status menu, active cards Forfeit; any other status has no
     action. Each control names its card, since every row repeats the same words. */
  const renderRowActions = (row: BonusAwardRow) => {
    const kind = bonusAwardRowActionKind(row.status)
    if (kind === 'pending') {
      return (
        <span className={styles.rowActions}>
          <Button
            variant="primary"
            size="xs"
            disabled={remarkSubmitLoading}
            aria-label={`Activate bonus card ${row.id}`}
            onClick={(event) => {
              rememberActionTrigger(event)
              openActivateWithRemark(row)
            }}
          >
            Activate
          </Button>
          <Menu
            trigger={(
              <Button
                size="xs"
                disabled={remarkSubmitLoading}
                aria-label={`Set status for bonus card ${row.id}`}
                onClick={rememberActionTrigger}
              >
                <span className={styles.menuLabel}>
                  Set status
                  <IconChevronDown size={ROW_ICON} stroke={strokeFor(ROW_ICON)} aria-hidden="true" />
                </span>
              </Button>
            )}
          >
            <MenuItem tone="danger" onSelect={() => openSetStatusWithRemark(String(row.id), 'cancelled')}>
              Cancel (revoke)
            </MenuItem>
            <MenuItem onSelect={() => openSetStatusWithRemark(String(row.id), 'expired')}>Mark expired</MenuItem>
          </Menu>
        </span>
      )
    }
    if (kind === 'active') {
      return (
        <Button
          variant="dangerSolid"
          size="xs"
          disabled={remarkSubmitLoading}
          aria-label={`Forfeit bonus card ${row.id}`}
          onClick={(event) => {
            rememberActionTrigger(event)
            openForfeitWithRemark(row)
          }}
        >
          Forfeit
        </Button>
      )
    }
    return <span className={styles.dim}>—</span>
  }

  // A failed list query (no errorPolicy, so no rows) shows its message with Retry instead of "no cards".
  const tableState = loading ? 'loading' : error && items.length === 0 ? 'error' : 'ready'
  const remarkBlank = !remarkDraft.trim()

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Bonus cards"
        sub="Player bonus awards — filter by date, status, domain, campaign, agent, or player. Times in IST."
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            loading={loading}
            onClick={() => void handleRefresh()}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <BonusAwardsStatsCards filters={filtersPayload} isAgent={isAgent} />

        <BonusAwardsFiltersBar
          filters={listFilters}
          onFiltersChange={setListFilters}
          onClear={handleClearListFilters}
          isAgent={isAgent}
          campaignOptions={campaignOptions}
          campaignsLoading={campaignsLoading}
        />

        <Card
          title="Bonus cards"
          sub={shownPage ? `${shownTotal.toLocaleString()} bonus card${shownTotal === 1 ? '' : 's'}` : undefined}
          body="table"
        >
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => String(row.id)}
            label="Bonus cards"
            state={tableState}
            error={error?.message}
            onRetry={() => {
              void refetch().catch(() => undefined)
            }}
            width="wide"
            empty={(
              <EmptyState
                title="No bonus cards for these filters"
                icon={<IconInbox size={20} stroke={strokeFor(20)} />}
              />
            )}
            rowActions={canChangePendingBonusStatus ? (row) => ({ primary: renderRowActions(row) }) : undefined}
          />
          {shownPage ? (
            <Pagination loading={loading}
              current={page}
              pageSize={limit}
              total={shownTotal}
              onChange={(p) => setOffset((p - 1) * limit)}
              onPageSizeChange={(size) => {
                setLimit(size)
                setOffset(0)
              }}
              itemName="cards"
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              variant="embedded"
            />
          ) : null}
        </Card>
      </div>

      <Dialog
        open={remarkModalMeta !== null}
        onOpenChange={(open) => {
          if (!open && !remarkSubmitLoading) setRemarkModal(null)
        }}
        title={remarkModalMeta?.title ?? ''}
        description={remarkModalMeta?.description}
        size="md"
        role="alertdialog"
        initialFocus={remarkFieldRef}
        restoreFocusTo={actionTriggerRef}
        dismissible={!remarkSubmitLoading}
        footer={(
          <>
            <Button disabled={remarkSubmitLoading} onClick={() => setRemarkModal(null)}>
              Back
            </Button>
            <Button
              variant={remarkModalMeta?.danger ? 'dangerSolid' : 'primary'}
              loading={remarkSubmitLoading}
              aria-disabled={remarkBlank ? true : undefined}
              aria-describedby={remarkBlank ? remarkReasonId : undefined}
              onClick={() => void handleRemarkModalSubmit()}
            >
              {remarkModalMeta?.okText}
            </Button>
          </>
        )}
      >
        <div className={styles.remarkBody}>
          {remarkModal?.mode === 'switch' ? (
            <Notice tone="warn" live="polite" icon={<IconAlertTriangle size={16} stroke={strokeFor(16)} />}>
              {SWITCH_BONUS_WARNING}
            </Notice>
          ) : null}
          <Textarea
            ref={(node) => {
              remarkFieldRef.current = node
            }}
            label={REMARK_LABEL}
            rows={3}
            value={remarkDraft}
            onChange={setRemarkDraft}
            maxLength={REMARK_MAX_LENGTH}
            showCount
            placeholder={REMARK_PLACEHOLDER}
          />
          <span id={remarkReasonId} className={styles.srOnly}>
            {REMARK_REQUIRED_MESSAGE}
          </span>
        </div>
      </Dialog>
    </Page>
  )
}
