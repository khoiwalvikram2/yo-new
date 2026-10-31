import { useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconCoinRupee,
  IconDotsVertical,
  IconEdit,
  IconPlayerPause,
  IconRefresh,
  IconSitemap,
  IconUserCheck,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import {
  agentDisplayName,
  creditUsagePercent,
  creditUsageTone,
  filterHierarchyAgents,
  hierarchyDepthLabel,
  type HierarchyAgentNode,
} from '@/routes/agents/hierarchyModel'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { SearchField } from '@/ui/components/SearchField'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from './HierarchyTree.module.css'

export interface HierarchyTreeProps {
  agents: readonly HierarchyAgentNode[]
  loading?: boolean
  refreshing?: boolean
  error?: Error
  selectedAgentId?: string | null
  onRefresh: () => void
  onSelectAgent?: (agentId: string) => void
  onAction?: (action: 'edit' | 'credit' | 'suspend' | 'activate', agentId: string) => void
}

export default function HierarchyTree({
  agents,
  loading = false,
  refreshing = false,
  error,
  selectedAgentId,
  onRefresh,
  onSelectAgent,
  onAction,
}: HierarchyTreeProps) {
  const [searchValue, setSearchValue] = useState('')
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const visibleAgents = useMemo(
    () => filterHierarchyAgents(agents, searchValue),
    [agents, searchValue],
  )

  const amount = (value?: number | null) => (
    formatAmount(convertFromWhitelabelCurrency(Number(value || 0)))
  )

  return (
    <Card
      title="Hierarchy map"
      sub={`${visibleAgents.length} of ${agents.length} agents shown`}
      body="flush"
      className={styles.card}
      tools={
        <div className={styles.tools}>
          <SearchField
            label="Search hierarchy"
            placeholder="Search agents"
            size="sm"
            value={searchValue}
            onChange={setSearchValue}
            className={styles.search}
          />
          <Button
            size="sm"
            icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
            loading={refreshing}
            onClick={onRefresh}
          >
            Refresh
          </Button>
        </div>
      }
    >
      {error ? (
        <div className={styles.noticeWrap}>
          <Notice
            tone="error"
            live="polite"
            title="Could not load the hierarchy"
            icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
            action={<Button size="sm" onClick={onRefresh}>Try again</Button>}
          >
            {error.message || 'Refresh the page and try again.'}
          </Notice>
        </div>
      ) : null}

      {loading && agents.length === 0 ? (
        <LoadingState label="Loading agent hierarchy" />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<IconSitemap size={20} stroke={strokeFor(20)} />}
          title="No sub-agents yet"
          description="Create a sub-agent to start building this hierarchy."
        />
      ) : visibleAgents.length === 0 ? (
        <EmptyState
          icon={<IconSitemap size={20} stroke={strokeFor(20)} />}
          title="No matching agents"
          description="Try a username, agent ID, scheme, status, or hierarchy level."
          action={<Button size="sm" onClick={() => setSearchValue('')}>Clear search</Button>}
        />
      ) : (
        <ul className={styles.tree} role="tree" aria-label="Agent hierarchy">
          {visibleAgents.map((agent) => {
            const isCredit = agent.schemeType === 'CREDIT'
            const usage = creditUsagePercent(agent)
            const level = Math.min(4, Math.max(1, Number(agent.levelIndex || 1)))
            const isSelected = selectedAgentId === agent.id

            return (
              <li
                className={styles.branch}
                key={agent.id}
                role="treeitem"
                aria-level={level}
                aria-selected={isSelected}
                data-level={level}
              >
                <span className={styles.connector} aria-hidden="true" />
                <div className={styles.row} data-selected={isSelected ? 'true' : undefined}>
                  <button
                    type="button"
                    className={styles.rowMain}
                    onClick={() => onSelectAgent?.(agent.id)}
                    aria-label={`View ${agentDisplayName(agent)} details`}
                  >
                    <span className={styles.avatar} aria-hidden="true">
                      {agentDisplayName(agent).slice(0, 2).toUpperCase()}
                    </span>
                    <span className={styles.identity}>
                      <span className={styles.name}>{agentDisplayName(agent)}</span>
                      <span className={styles.meta}>
                        <span>{hierarchyDepthLabel(agent.levelIndex)}</span>
                        <span aria-hidden="true">•</span>
                        <span className={styles.id}>{agent.id}</span>
                      </span>
                    </span>
                    <span className={styles.pills}>
                      <StatusPill tone={isCredit ? 'info' : 'neutral'}>{agent.schemeType}</StatusPill>
                      <StatusPill status={agent.status}>{agent.status}</StatusPill>
                    </span>
                    {isCredit ? (
                      <span className={styles.credit}>
                        <span className={styles.creditTop}>
                          <span>{Math.round(usage)}% used</span>
                          <strong>{amount(agent.creditAvailable)} available</strong>
                        </span>
                        <Meter value={usage} tone={creditUsageTone(usage)} />
                      </span>
                    ) : (
                      <span className={styles.schemeNote}>Revenue-sharing account</span>
                    )}
                  </button>

                  <Menu
                    trigger={
                      <IconButton
                        label={`Actions for ${agentDisplayName(agent)}`}
                        icon={<IconDotsVertical size={17} stroke={strokeFor(17)} />}
                        variant="bordered"
                      />
                    }
                  >
                    <MenuItem
                      icon={<IconEdit size={15} stroke={strokeFor(15)} />}
                      onSelect={() => onAction?.('edit', agent.id)}
                    >
                      Edit agent
                    </MenuItem>
                    <MenuItem
                      icon={<IconCoinRupee size={15} stroke={strokeFor(15)} />}
                      onSelect={() => onAction?.('credit', agent.id)}
                    >
                      Adjust credit
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      tone={agent.status === 'SUSPENDED' ? 'default' : 'danger'}
                      icon={agent.status === 'SUSPENDED'
                        ? <IconUserCheck size={15} stroke={strokeFor(15)} />
                        : <IconPlayerPause size={15} stroke={strokeFor(15)} />}
                      onSelect={() => onAction?.(
                        agent.status === 'SUSPENDED' ? 'activate' : 'suspend',
                        agent.id,
                      )}
                    >
                      {agent.status === 'SUSPENDED' ? 'Activate agent' : 'Suspend agent'}
                    </MenuItem>
                  </Menu>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className={styles.legend} aria-label="Hierarchy legend">
        <span className={styles.legendTitle}>Status</span>
        <span><i className={styles.okDot} aria-hidden="true" /> Active</span>
        <span><i className={styles.warnDot} aria-hidden="true" /> Suspended</span>
        <span><i className={styles.negDot} aria-hidden="true" /> Blocked</span>
      </div>
    </Card>
  )
}
