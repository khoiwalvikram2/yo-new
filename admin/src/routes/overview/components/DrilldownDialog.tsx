import { useCallback, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { DASHBOARD_DRILLDOWN_QUERY } from '../graphql'
import { useDashboardStore } from '@/state/dashboardStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { ROUTES } from '@/shared/core/constants'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useNeedsWhitelabelSelection } from '@/modules/matka/whitelabelScope'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Dialog } from '@/ui/components/Dialog'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { SearchField } from '@/ui/components/SearchField'
import { StatusPill } from '@/ui/components/StatusPill'
import { Table, TBody, TD, TH, THead, TR } from '@/ui/components/Table'
import { DrilldownContext, useDrilldown, type DrillRequest } from './drilldownContext'
import { count, formatDuration } from './insightFormat'
import styles from './DrilldownDialog.module.css'

/* The dashboard's drill-downs (the owner's ask, 2026-10-29): every figure that stands for a list of
   players, requests, bets or agents opens that list in a modal, one page at a time, searchable by name or
   phone, with players and agents linked to their pages and a link to the page that manages the rows.
   DrilldownProvider wraps the dashboard; DrillButton turns a figure into the modal's trigger. */

interface DrillColumn {
  key: string
  label: string
  kind: string
}

interface DrillRow {
  id: string
  cells: Array<string | null>
  playerId: number | null
  agentId: string | null
}

interface Drilldown {
  kind: string
  title: string
  subtitle: string
  columns: DrillColumn[]
  rows: DrillRow[]
  total: number
  page: string | null
}

const PAGE_SIZE = 25
const RIGHT = new Set(['money', 'count', 'percent', 'duration'])

/** A figure as the modal's trigger. Outside a DrilldownProvider it renders its content unchanged. */
export function DrillButton({ drill, children, className }: { drill: DrillRequest; children: ReactNode; className?: string }) {
  const open = useDrilldown()
  if (!open) return <>{children}</>
  return (
    <button
      type="button"
      className={className ? `${styles.trigger} ${className}` : styles.trigger}
      onClick={() => open(drill)}
      aria-haspopup="dialog"
      title={drill.title ? `Show the ${drill.title.toLowerCase()} in detail` : 'Show details'}
    >
      {children}
    </button>
  )
}

/** Wraps the dashboard. `enabled` false (an agent's session, which the drill-down query refuses) leaves every
    figure plain. */
export function DrilldownProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [request, setRequest] = useState<DrillRequest | null>(null)
  const open = useCallback((next: DrillRequest) => setRequest(next), [])
  return (
    <DrilldownContext.Provider value={enabled ? open : null}>
      {children}
      {request ? <DrilldownDialog key={`${request.kind}:${request.arg ?? ''}`} request={request} onClose={() => setRequest(null)} /> : null}
    </DrilldownContext.Provider>
  )
}

function DrilldownDialog({ request, onClose }: { request: DrillRequest; onClose: () => void }) {
  const { getDateRangeForQuery } = useDashboardStore()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const { data, loading, error } = useQuery(DASHBOARD_DRILLDOWN_QUERY, {
    variables: { kind: request.kind, arg: request.arg ?? null, dateRange: getDateRangeForQuery(), search: search || null, limit: PAGE_SIZE, offset },
    fetchPolicy: 'network-only',
    errorPolicy: 'all',
  })
  const d: Drilldown | undefined = data?.dashboardDrilldown
  const title = request.title ?? d?.title ?? 'Details'
  // A Super Admin in core mode drills into every whitelabel's players, whose profiles core mode cannot open
  // ("Player not found", PLA-05): the name is plain text there, as on the dashboard's cards (DashboardPlayerName).
  const crossSite = useNeedsWhitelabelSelection()

  const money = (value: string) => {
    const n = Number(value)
    return `${n < 0 ? '-' : ''}${formatAmount(convertFromWhitelabelCurrency(Math.abs(n)))}`
  }

  const render = (column: DrillColumn, value: string | null, row: DrillRow): ReactNode => {
    if (value === null || value === '') return <span className={styles.none}>—</span>
    switch (column.kind) {
      case 'player':
        return row.playerId !== null && !crossSite
          ? <Link className={styles.link} to={ROUTES.PLAYERS_PROFILE.replace(':playerId', String(row.playerId))} onClick={onClose}>{value}</Link>
          : value
      case 'agent':
        return row.agentId ? <Link className={styles.link} to={`/agents/${row.agentId}`} onClick={onClose}>{value}</Link> : value
      case 'money':
        return money(value)
      case 'count':
        return count(Number(value))
      case 'percent':
        return `${(Number(value) * 100).toFixed(1)}%`
      case 'duration':
        return formatDuration(Number(value))
      case 'datetime':
        return formatDateTime(value)
      case 'status':
        return <StatusPill status={value}>{value.toLowerCase()}</StatusPill>
      default:
        return value
    }
  }

  const total = d?.total ?? 0
  const first = total === 0 ? 0 : offset + 1
  const last = Math.min(offset + PAGE_SIZE, total)

  return (
    <Dialog
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      size="xl"
      title={title}
      description={d ? `${d.subtitle} · ${count(total)} ${total === 1 ? 'row' : 'rows'}` : 'Loading…'}
      footer={
        <div className={styles.foot}>
          <span className={styles.range}>{total > 0 ? `${count(first)}–${count(last)} of ${count(total)}` : ''}</span>
          <div className={styles.pager}>
            <Button size="sm" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={last >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
            {d?.page ? <Link className={buttonClassName({ variant: 'primary', size: 'sm' })} to={d.page} onClick={onClose}>Open full page</Link> : null}
          </div>
        </div>
      }
    >
      <div className={styles.body}>
        <SearchField
          label="Search by player, name, phone or agent"
          size="sm"
          value={typed}
          onChange={setTyped}
          onSubmit={(value) => { setSearch(value.trim()); setOffset(0) }}
          placeholder="Search name, phone or agent"
        />
        {error && !data ? (
          <Notice tone="error" title="Details unavailable">{error.message}</Notice>
        ) : !d ? (
          <LoadingState height={320} label="Loading details" />
        ) : d.rows.length === 0 ? (
          <p className={styles.empty}>{search ? `Nothing matches “${search}”.` : 'Nothing to show for this figure.'}</p>
        ) : (
          <div className={styles.table} aria-busy={loading || undefined}>
            <Table caption={title} width="fill" inset>
              <THead>
                <TR>
                  {d.columns.map((column) => (
                    <TH key={column.key} align={RIGHT.has(column.kind) ? 'right' : 'left'}>{column.label}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {d.rows.map((row) => (
                  <TR key={row.id}>
                    {d.columns.map((column, index) => (
                      <TD key={column.key} align={RIGHT.has(column.kind) ? 'right' : 'left'} emphasis={column.kind === 'player' ? 'key' : undefined}>
                        {render(column, row.cells[index], row)}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </Dialog>
  )
}
