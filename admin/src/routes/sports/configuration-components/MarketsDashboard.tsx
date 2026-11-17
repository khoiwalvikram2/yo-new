import { useMemo } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { LIST_MARKETS, SET_MARKET_STATUS } from '@/lib/graphql/sports'
import { useSportsScopeStore } from '@/state/sportsScopeStore'
import { useSportsConfigStore } from '@/state/sportsConfigStore'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { TextField } from '@/ui/components/TextField'
import { Notice } from '@/ui/components/Notice'
import { Switch } from '@/ui/components/Switch'
import { StatusPill } from '@/ui/components/StatusPill'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { useCanEditCatalogue } from './catalogueAccess'
import type { MarketRecord } from './settingsModel'
const EMPTY_MARKETS: MarketRecord[] = []
export function MarketsDashboard() {
  const { formatDateTime } = useFormatDate()
  // A market's status is the platform's (catalogueAccess): anyone else reads it.
  const canEditCatalogue = useCanEditCatalogue()
  const selectedEventId = useSportsScopeStore(s => s.selectedEventId)
  const search = useSportsConfigStore(s => s.search); const setSearch = useSportsConfigStore(s => s.setSearch)
  const [setStatus] = useMutation(SET_MARKET_STATUS, { refetchQueries: [{ query: LIST_MARKETS, variables: { eventId: selectedEventId || '' } }] })
  const { data, loading, error, refetch } = useQuery<{ marketsByEvent: MarketRecord[] }>(LIST_MARKETS, { variables: { eventId: selectedEventId || '' }, skip: !selectedEventId, fetchPolicy: 'cache-and-network', errorPolicy: 'all' })
  const items = data?.marketsByEvent || EMPTY_MARKETS
  const filtered = useMemo(() => items.filter(m => !search || [m.name,m.id,m.type || ''].some(value => value.toLowerCase().includes(search.toLowerCase()))), [items, search])
  async function update(id: string, active: boolean) {
    try { await setStatus({ variables: { id, status: active ? 'active' : 'inactive' }, context: { uiToast: 'message' } }); await refetch() }
    catch { /* Existing Apollo notification handles a failed status update. */ }
  }
  const columns: DataTableColumn<MarketRecord>[] = [{ key: 'name', header: 'Market Name', cell: row => row.name }, { key: 'type', header: 'Type', cell: row => row.type || 'match_odds' }, { key: 'updated', header: 'Updated', cell: row => row.updatedAt ? formatDateTime(row.updatedAt,'MMM d, yyyy HH:mm') : '—' }, { key: 'status', header: 'Status', cell: row => {
    const active = (row.status || 'active').toLowerCase() === 'active'
    return canEditCatalogue ? <Switch label={'Active ' + row.name} checked={active} onChange={value => void update(row.id, value)} /> : <StatusPill tone={active ? 'ok' : 'neutral'}>{active ? 'ACTIVE' : 'INACTIVE'}</StatusPill>
  } }]
  return <Card title="Markets Management" sub="Manage markets for the selected event" body="table" tools={selectedEventId && <TextField label="Search markets" hideLabel value={search} onChange={setSearch} clearable placeholder="Search markets..." />}>
    {!selectedEventId ? <Notice>Please select an event from the top controls or click the event from the events table.</Notice> : <DataTable label="Markets" columns={columns} rows={filtered} rowKey={row => row.id} state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message} onRetry={() => void refetch()} empty="No markets found for this event" pagination={false} />}
  </Card>
}
