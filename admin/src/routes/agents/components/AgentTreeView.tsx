import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useApolloClient } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconChevronDown, IconChevronRight, IconHierarchy2 } from '@tabler/icons-react'
import { AGENTS_PAGE_QUERY, AGENTS_STATS_QUERY } from '@/lib/graphql/agents'
import { Avatar } from '@/ui/components/Avatar'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { CopyButton } from '@/ui/components/CopyButton'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { agentLevelNames, creditUsage, type AgentListRow, type AgentsPageData } from './agentsSearchModel'
import styles from './AgentTreeView.module.css'

const BRANCH_PAGE_SIZE = 20
interface Branch {
  rows: AgentListRow[]
  total: number
  nextOffset: number
  loading: boolean
  loaded: boolean
  error?: boolean
  statsErrors: number[]
  statsLoading: number[]
}
const emptyBranch = (): Branch => ({ rows: [], total: 0, nextOffset: 0, loading: false, loaded: false, statsErrors: [], statsLoading: [] })

interface AgentTreeViewProps {
  roots: AgentListRow[]
  schemeType: string
  status: string
  formatAmount: (amount: number | null | undefined) => string
  pending: (row: AgentListRow) => ReactNode
  lastLogin: (value: string | null | undefined) => string
}
interface TreeColumn { key: string; header: string; cell: (row: AgentListRow) => ReactNode }

/** Each mounted view owns its branch cache. The parent keys it by filters, scope and root page. */
export function AgentTreeView({ roots, schemeType, status, formatAmount, pending, lastLogin }: AgentTreeViewProps) {
  const client = useApolloClient()
  const regionId = useId()
  const [expanded, setExpanded] = useState<string[]>([])
  const [branches, setBranches] = useState<Record<string, Branch>>({})
  const [expanding, setExpanding] = useState(false)
  const branchCache = useRef<Record<string, Branch>>({})
  const active = useRef(true)
  const expandingFirstLevel = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; expandingFirstLevel.current = false }
  }, [])

  const updateBranch = (parentId: string, update: (branch: Branch) => Branch) => {
    if (!active.current) return
    const next = { ...branchCache.current, [parentId]: update(branchCache.current[parentId] ?? emptyBranch()) }
    branchCache.current = next
    setBranches(next)
  }
  const variablesFor = (parentAgentId: string, offset: number) => ({ parentAgentId, schemeType: schemeType || undefined, status: status || undefined, limit: BRANCH_PAGE_SIZE, offset })

  const loadStats = async (parentId: string, offset: number) => {
    if (branchCache.current[parentId]?.statsLoading.includes(offset)) return
    updateBranch(parentId, branch => ({ ...branch, statsLoading: [...branch.statsLoading, offset], statsErrors: branch.statsErrors.filter(value => value !== offset) }))
    try {
      const { data } = await client.query<AgentsPageData>({ query: AGENTS_STATS_QUERY, variables: variablesFor(parentId, offset), fetchPolicy: 'no-cache' })
      const stats = new Map(data?.agents?.agentsPage?.itemsWithStats?.map(item => [item.agent.id, item.stats]) ?? [])
      updateBranch(parentId, branch => ({ ...branch, rows: branch.rows.map(row => stats.has(row.id) ? { ...row, stats: stats.get(row.id) } : row) }))
    } catch {
      updateBranch(parentId, branch => ({ ...branch, statsErrors: [...branch.statsErrors, offset] }))
    } finally {
      updateBranch(parentId, branch => ({ ...branch, statsLoading: branch.statsLoading.filter(value => value !== offset) }))
    }
  }

  const loadChildren = async (parentId: string, more = false) => {
    const cached = branchCache.current[parentId]
    if (!active.current || cached?.loading || (cached?.loaded && !more)) return
    const offset = more ? cached?.nextOffset ?? 0 : 0
    updateBranch(parentId, branch => ({ ...branch, loading: true, error: false }))
    try {
      const { data } = await client.query<AgentsPageData>({ query: AGENTS_PAGE_QUERY, variables: variablesFor(parentId, offset), fetchPolicy: 'no-cache' })
      if (!active.current) return
      const page = data?.agents?.agentsPage
      const items = page?.items ?? []
      updateBranch(parentId, branch => ({ ...branch, loaded: true, loading: false, total: page?.total ?? items.length,
        nextOffset: items.length ? offset + items.length : page?.total ?? offset,
        rows: [...new Map([...branch.rows, ...items.filter(row => row.id !== parentId)].map(row => [row.id, row])).values()],
      }))
      // Identity appears first; aggregate activity follows without blocking expansion.
      if (items.length) await loadStats(parentId, offset)
    } catch {
      updateBranch(parentId, branch => ({ ...branch, loading: false, error: true }))
    }
  }

  const toggle = (row: AgentListRow) => {
    const isOpen = expanded.includes(row.id)
    setExpanded(previous => isOpen ? previous.filter(id => id !== row.id) : [...previous, row.id])
    if (!isOpen) void loadChildren(row.id)
  }
  const expandFirstLevel = async () => {
    setExpanded(previous => [...new Set([...previous, ...roots.map(row => row.id)])])
    setExpanding(true)
    expandingFirstLevel.current = true
    // Bound simultaneous requests when the root page contains up to 100 agents.
    for (let index = 0; index < roots.length && active.current && expandingFirstLevel.current; index += 3) {
      await Promise.all(roots.slice(index, index + 3).map(row => loadChildren(row.id)))
    }
    if (!active.current) return
    // Opening every root at once would leave a "No sub-agents" line under each empty one; those close again.
    const rootIds = new Set(roots.map(row => row.id))
    setExpanded(previous => previous.filter(id => !(rootIds.has(id) && branchCache.current[id]?.loaded && branchCache.current[id].total === 0)))
    setExpanding(false)
  }

  // The same four figures sit in the same place on every level, so nested rows line up under the header.
  // Before an agent's stats arrive its figures stay unknown ("—"), never zero.
  const players: TreeColumn = { key: 'players', header: 'Players', cell: row => row.stats?.activePlayers ?? '—' }
  const login: TreeColumn = { key: 'login', header: 'Last login', cell: row => row.stats ? lastLogin(row.stats.lastLogin) : '—' }
  const columns: TreeColumn[] = schemeType === 'COMMISSION' ? [
    players,
    { key: 'turnover', header: 'Turnover', cell: row => formatAmount(row.stats?.turnover) },
    { key: 'earned', header: 'Earned', cell: row => formatAmount(row.stats?.commissionEarned) },
    login,
  ] : schemeType === 'CREDIT' ? [
    players,
    { key: 'credit', header: 'Credit used', cell: row => { const usage = creditUsage(row)
      return usage.limit > 0 ? <span className={usage.high ? styles.creditHigh : styles.credit}><span>{usage.percent}%</span><Meter value={usage.percent} tone={usage.high ? 'warn' : 'acc'} className={styles.creditMeter} /></span> : '—' } },
    { key: 'available', header: 'Available', cell: row => formatAmount(row.creditAvailable) },
    login,
  ] : [
    players,
    { key: 'pl', header: 'P/L', cell: row => { const value = row.stats?.profitLoss
      return <span className={value == null || value === 0 ? undefined : value > 0 ? styles.positive : styles.negative}>{formatAmount(value)}</span> } },
    { key: 'pending', header: 'Pending', cell: row => row.stats ? pending(row) : '—' },
    login,
  ]

  const renderNode = (row: AgentListRow, ancestors: string[] = []): ReactNode => {
    if (ancestors.includes(row.id)) return null
    const branch = branches[row.id]
    const isOpen = expanded.includes(row.id)
    const name = row.username || row.id
    const childrenId = `${regionId}-children-${row.id}`
    // Below level 4 only commission agents can add agents, so a level-4 credit or sharing agent is always a leaf.
    // Once a closed branch is known to be empty there is nothing to open either.
    const canHaveChildren = !(row.levelIndex === 4 && row.schemeType !== 'COMMISSION') && !(branch?.loaded && branch.total === 0 && !isOpen)
    return <li key={row.id} className={styles.node}>
      <div className={styles.row} data-expanded={isOpen || undefined}>
        <div className={styles.identity}>
          {canHaveChildren
            ? <Button className={styles.expand} size="sm" variant="ghost" aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${name}`} aria-expanded={isOpen} aria-controls={childrenId} onClick={() => toggle(row)} icon={isOpen ? <IconChevronDown size={17} /> : <IconChevronRight size={17} />} />
            : <span className={styles.leaf} aria-hidden="true" />}
          <Avatar name={row.username} hue="auto" className={styles.avatar} />
          <div className={styles.person}>
            <div className={styles.name}><Link to={`/agents/${row.id}`}>{name}</Link><CopyButton value={name} label={`Copy username ${name}`} />{row.tallyEnabled && <StatusPill tone="ok">Tally</StatusPill>}</div>
            <div className={styles.meta}>
              {row.levelIndex ? <span className={styles.level}>L{row.levelIndex}</span> : null}
              <span>{row.levelIndex ? agentLevelNames[row.levelIndex] || `Level ${row.levelIndex}` : 'Agent'}</span>
              {branch?.loaded && <span>{branch.total} sub-agent{branch.total === 1 ? '' : 's'}</span>}
            </div>
          </div>
        </div>
        {columns.map(column => <div key={column.key} className={styles.cell} data-col={column.key}><span className={styles.cellLabel}>{column.header}</span><span className={styles.value}>{column.cell(row)}</span></div>)}
        <div className={styles.statusCell}><StatusPill status={row.status}>{row.status === 'ACTIVE' ? 'Active' : row.status === 'SUSPENDED' ? 'Suspended' : 'Inactive'}</StatusPill></div>
        <div className={styles.actions}><Link to={`/agents/${row.id}`} className={buttonClassName({ size: 'sm' })} aria-label={`View profile ${name}`}>View</Link></div>
      </div>
      <div id={childrenId} className={styles.branch} hidden={!isOpen}>{isOpen && <>
        {branch?.loading && !branch.loaded && <p className={styles.message} role="status">Loading sub-agents…</p>}
        {branch?.error && <div className={styles.message} role="alert">Could not load sub-agents. <Button size="sm" onClick={() => void loadChildren(row.id, branch.loaded)}>Retry sub-agents</Button></div>}
        {branch?.loaded && branch.rows.length === 0 && <p className={styles.message}>No sub-agents{status ? ' match this status' : ''}.</p>}
        {branch && branch.statsErrors.length > 0 && <div className={styles.message} role="alert">Activity totals unavailable. <Button size="sm" onClick={() => { for (const offset of branch.statsErrors) void loadStats(row.id, offset) }}>Retry activity</Button></div>}
        {branch && branch.rows.length > 0 && <ul className={styles.children} aria-label={`Sub-agents of ${name}`}>{branch.rows.map(child => renderNode(child, [...ancestors, row.id]))}</ul>}
        {branch?.loaded && branch.nextOffset < branch.total && !branch.error && <div className={styles.more}><span>{branch.rows.length} of {branch.total} sub-agents</span><Button size="sm" loading={branch.loading} onClick={() => void loadChildren(row.id, true)}>Load more sub-agents</Button></div>}
      </>}</div>
    </li>
  }

  return <section className={styles.treeView} aria-label="Agent hierarchy">
    <div className={styles.toolbar}>
      <div className={styles.hint}>
        <IconHierarchy2 size={17} aria-hidden />
        <span className={styles.hintTitle}>Agent hierarchy</span>
        <span className={styles.legend}>{[1, 2, 3, 4].map(level => <span key={level}><b>L{level}</b> {agentLevelNames[level]}</span>)}</span>
      </div>
      <div className={styles.toolbarActions}>
        <Button size="sm" disabled={!expanded.length} onClick={() => { expandingFirstLevel.current = false; setExpanded([]) }}>Collapse all</Button>
        <Button size="sm" icon={<IconChevronDown size={14} />} loading={expanding} onClick={() => void expandFirstLevel()}>Expand first level</Button>
      </div>
    </div>
    <div className={styles.head} aria-hidden="true">
      <span>Agent</span>
      {columns.map(column => <span key={column.key} data-col={column.key}>{column.header}</span>)}
      <span>Status</span>
      <span />
    </div>
    <ul className={styles.tree} aria-label="Agents">{roots.map(row => renderNode(row))}</ul>
  </section>
}
