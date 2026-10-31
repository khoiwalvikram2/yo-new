import { useState, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { useQuery, useApolloClient, gql } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconChevronDown, IconChevronRight, IconHierarchy2, IconScale, IconUserCheck, IconUserOff } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import dayjs from 'dayjs'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { profileSchemeLabels } from './agentProfileModel'
import styles from './AgentProfileComponents.module.css'

const AGENT_TREE_QUERY = gql`
  query AgentTree($rootId: ID!) {
    agents {
      agentTree(rootId: $rootId) {
        id
        username
        phone
        schemeType
        status
        parentAgentId
        levelIndex
        allowedDomains
        tallyEnabled
        tallyDomains
        commissionRates {
          domain
          rate
        }
        creditLimit
        creditUsed
        creditAvailable
        createdAt
      }
    }
  }
`

interface SubAgent {
  id: string
  username?: string
  phone?: string
  schemeType: string
  status: string
  parentAgentId?: string
  levelIndex?: number
  allowedDomains?: string[]
  tallyEnabled?: boolean
  tallyDomains?: string[]
  commissionRates?: Array<{ domain: string; rate?: number }>
  creditLimit?: number
  creditUsed?: number
  creditAvailable?: number
  createdAt?: string
}

interface SubAgentsTabProps {
  agentId: string
}

const domainName = (domain: string) => domain ? domain[0].toUpperCase() + domain.slice(1) : domain

export function SubAgentsTab({ agentId }: SubAgentsTabProps) {
  const client = useApolloClient()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const fmt = (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0)))
  // On a phone the table keeps the sub-agent and its status; the setup goes under the name.
  const { isMobile } = useBreakpoint()

  const { data: rootData, loading: rootLoading, error: rootError, refetch: refetchRoot } = useQuery(AGENT_TREE_QUERY, {
    variables: { rootId: agentId },
    fetchPolicy: 'cache-and-network',
    skip: !agentId,
  })

  const directChildren: SubAgent[] = rootData?.agents?.agentTree ?? []

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [childrenMap, setChildrenMap] = useState<Map<string, SubAgent[]>>(new Map())
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set())
  const childrenMapRef = useRef(childrenMap)
  childrenMapRef.current = childrenMap

  const fetchChildren = useCallback(async (parentId: string) => {
    if (childrenMapRef.current.has(parentId)) return
    setLoadingIds(prev => new Set(prev).add(parentId))
    try {
      const { data } = await client.query({ query: AGENT_TREE_QUERY, variables: { rootId: parentId }, fetchPolicy: 'network-only' })
      const children: SubAgent[] = data?.agents?.agentTree ?? []
      setChildrenMap(prev => new Map(prev).set(parentId, children))
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev)
        next.delete(parentId)
        return next
      })
    }
  }, [client])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        void fetchChildren(id).catch(() => undefined)
      }
      return next
    })
  }, [fetchChildren])

  const buildTreeData = (agents: SubAgent[], depth: number = 0): (SubAgent & { _depth?: number })[] => {
    return agents.flatMap(agent => {
      const enriched = { ...agent, _depth: depth } as SubAgent & { _depth: number }
      const rows: (SubAgent & { _depth?: number })[] = [enriched]
      if (expandedIds.has(agent.id)) {
        const children = childrenMap.get(agent.id) ?? []
        if (children.length > 0) {
          rows.push(...buildTreeData(children, depth + 1))
        }
      }
      return rows
    })
  }

  const flatData = buildTreeData(directChildren)

  // The figures count the direct sub-agents (the first level of the tree).
  const pending = rootLoading && !rootData
  const activeCount = directChildren.filter(child => child.status?.toUpperCase() === 'ACTIVE').length
  const tallyCount = directChildren.filter(child => child.tallyEnabled).length
  const share = (count: number) => directChildren.length > 0 ? `${((count / directChildren.length) * 100).toFixed(0)}% of them` : 'None yet'
  // A rate column only when a commission sub-agent is listed, a credit column only for a credit one.
  const showRates = flatData.some(row => row.schemeType === 'COMMISSION' && row.commissionRates?.length)
  const showCredit = flatData.some(row => row.schemeType === 'CREDIT')
  const domainsText = (row: SubAgent) => row.allowedDomains?.length ? row.allowedDomains.map(domainName).join(' · ') : '—'
  const tallyText = (row: SubAgent) => row.tallyEnabled ? `Tally on${row.tallyDomains?.length ? `: ${row.tallyDomains.map(domainName).join(', ')}` : ''}` : 'Tally off'

  const columns: DataTableColumn<SubAgent & { _depth?: number }>[] = [
    { key: 'agent', header: 'Sub-Agent', cell: row => {
      const expanded = expandedIds.has(row.id), loading = loadingIds.has(row.id), empty = childrenMap.has(row.id) && !childrenMap.get(row.id)?.length
      const meta = [row.phone, row.levelIndex != null ? `Level ${row.levelIndex}` : null].filter(Boolean).join(' · ')
      return <div className={styles.treeLabel}>
        {Array.from({ length: row._depth || 0 }, (_, index) => <span key={index} className={styles.treeIndent} aria-hidden="true" />)}
        {empty ? <span className={styles.treeLeaf} aria-hidden="true">•</span> : <Button size="xs" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.username || row.id}`} loading={loading} aria-expanded={expanded} icon={expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />} onClick={() => toggleExpand(row.id)} />}
        <span className={styles.rowDetails}>
          <Link className={styles.link} to={`/agents/${row.id}`}><strong>{row.username || row.id}</strong></Link>
          {meta && <span className={styles.muted}>{meta}</span>}
          {isMobile && <span className={styles.muted}>{profileSchemeLabels[row.schemeType] ?? row.schemeType} · {domainsText(row)}</span>}
        </span>
      </div>
    } },
    { key: 'scheme', header: 'Scheme', hidden: isMobile, cell: row => <StatusPill tone="info">{row.schemeType}</StatusPill> },
    { key: 'status', header: 'Status', cell: row => <StatusPill status={row.status}>{row.status?.toUpperCase() || '—'}</StatusPill> },
    { key: 'domains', header: 'Domains', hidden: isMobile, cell: row => <div className={styles.rowDetails}><span>{domainsText(row)}</span><span className={styles.muted}>{tallyText(row)}</span></div> },
    { key: 'rates', header: 'Commission Rates', hidden: isMobile || !showRates, cell: row => row.schemeType === 'COMMISSION' && row.commissionRates?.length ? <div className={styles.rowDetails}>{row.commissionRates.map(rate => <span key={rate.domain}>{domainName(rate.domain)} {rate.rate != null ? `${rate.rate.toFixed(2)}%` : '—'}</span>)}</div> : '—' },
    { key: 'credit', header: 'Credit', align: 'right', hidden: isMobile || !showCredit, cell: row => row.schemeType === 'CREDIT' ? <div className={clsx(styles.rowDetails, styles.cellEnd)}><span>{fmt(row.creditAvailable || 0)} available</span><span className={styles.muted}>Used {fmt(row.creditUsed || 0)} of {fmt(row.creditLimit || 0)}</span></div> : '—' },
    { key: 'created', header: 'Joined', hidden: isMobile, cell: row => row.createdAt ? dayjs(row.createdAt).format('DD MMM YYYY') : '—' },
  ]
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <div className={styles.tabKpis} role="group" aria-label="Sub-agent figures">
      <AccountListMetric label="Direct Sub-Agents" value={directChildren.length} note="Expand a row for the agents under it" icon={<IconHierarchy2 size={18} />} hue="blu" loading={pending} />
      <AccountListMetric label="Active" value={activeCount} note={share(activeCount)} icon={<IconUserCheck size={18} />} hue="grn" loading={pending} />
      <AccountListMetric label="Not Active" value={directChildren.length - activeCount} note="Inactive or suspended" icon={<IconUserOff size={18} />} hue="amb" loading={pending} />
      <AccountListMetric label="Tally On" value={tallyCount} note={share(tallyCount)} icon={<IconScale size={18} />} hue="vio" loading={pending} />
    </div>
    <Card title="Sub-Agent Hierarchy" sub={`${directChildren.length} direct sub-agent${directChildren.length === 1 ? '' : 's'} · use the arrow to open a branch`} body="table" tools={<div className={styles.actions}><Button size="sm" onClick={() => { setExpandedIds(new Set()); setChildrenMap(new Map()) }}>Collapse All</Button><Button size="sm" onClick={() => { void refetchRoot(); setChildrenMap(new Map()); setExpandedIds(new Set()) }}>Refresh</Button></div>}>
      <DataTable label="Sub-agent hierarchy" rows={flatData} rowKey={row => row.id} columns={columns} state={rootLoading ? 'loading' : rootError ? 'error' : 'ready'} error={rootError?.message} onRetry={() => void refetchRoot()} empty={<EmptyState title="No sub-agents found" />} pagination={false}
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined} />
    </Card>
  </div>
}
