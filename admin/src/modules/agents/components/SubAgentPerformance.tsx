import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { Button } from '@/ui/components/Button'
import { EmptyState } from '@/ui/components/EmptyState'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../AgentHome.module.css'

const SUB_AGENTS_QUERY = gql`
  query SubAgents($parentAgentId: ID!) {
    agents {
      agentTree(rootId: $parentAgentId, depth: 1) {
        id
        username
        schemeType
        status
        allowedDomains
        createdAt
      }
    }
  }
`

interface SubAgentPerformanceProps { agentId: string; periodFrom: string; periodTo: string }
interface SubAgentRow { id: string; username?: string; schemeType?: string; status?: string; allowedDomains?: string[] }
export default function SubAgentPerformance({ agentId }: SubAgentPerformanceProps) {
  const navigate = useNavigate()
  const { formatAmount } = useCurrency()
  const agent = useAuthStore(s => s.agent)
  const canCreateSubAgent = !agent || agent.schemeType === 'COMMISSION' || agent.levelIndex == null || agent.levelIndex < 4
  const [page, setPage] = useState(1)
  const { data, loading, error } = useQuery<{ agents?: { agentTree?: SubAgentRow[] } }>(SUB_AGENTS_QUERY, { variables: { parentAgentId: agentId }, skip: !agentId })
  const subAgents = data?.agents?.agentTree || []
  const activeSubAgents = subAgents.filter(a => a.status === 'ACTIVE').length
  const columns: DataTableColumn<SubAgentRow>[] = [
    { key: 'agent', header: 'Sub-Agent', cell: a => a.username || `Agent ${a.id.slice(0, 8)}` },
    { key: 'status', header: 'Status', cell: a => <StatusPill tone={a.status === 'ACTIVE' ? 'ok' : a.status === 'SUSPENDED' ? 'warn' : 'neg'}>{a.status ?? 'Unknown'}</StatusPill> },
    { key: 'scheme', header: 'Scheme', cell: a => a.schemeType },
    { key: 'domains', header: 'Domains', cell: a => (a.allowedDomains ?? []).join(', ') },
    { key: 'actions', header: 'Actions', cell: a => <div className={styles.actions}><Button size="xs" variant="link" onClick={() => navigate(`/agents/${a.id}`)}>View</Button><Button size="xs" variant="link" onClick={() => navigate(`/agents/hierarchy?subAgentId=${a.id}`)}>Manage</Button></div> },
  ]
  const empty = <EmptyState title="No sub-agents found" description="Create sub-agents to manage your hierarchy." action={(agent?.schemeType === 'SHARING' || agent?.schemeType === 'CREDIT') && canCreateSubAgent && <Button variant="primary" onClick={() => navigate(agent ? '/agent/create' : '/agents/create')}>Create Sub-Agent</Button>} />
  return <div className={styles.stack}>
    {subAgents.length > 0 && <div className={styles.three}>
      <Stat label="Total Sub-Agents" value={subAgents.length} note={`${activeSubAgents} active`} />
      <Stat label="Active Sub-Agents" value={activeSubAgents} />
      <Stat label="Total GGR" value={formatAmount(0)} note="Placeholder only · INR · No sub-agent GGR source is connected here." />
    </div>}
    <Card title="Sub-Agent Performance" body="table"><DataTable columns={columns} rows={subAgents.slice((page - 1) * 10, page * 10)} rowKey={a => a.id} label="Sub-agents" width="wide" state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message} empty={empty} pagination={{ current: page, pageSize: 10, total: subAgents.length, onChange: setPage, onPageSizeChange: () => {}, pageSizeOptions: [10], itemName: 'sub-agents' }} /></Card>
  </div>
}

