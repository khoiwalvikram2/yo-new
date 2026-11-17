import { useMemo, useState } from 'react'
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconEdit,
  IconPlayerPause,
  IconRefresh,
  IconSitemap,
  IconUserCheck,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { ChipActions, chipTone, roundChips, signedChips, type ChipAccount } from '@/modules/chips'
import {
  agentDisplayName,
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
import { Notice } from '@/ui/components/Notice'
import { SearchField } from '@/ui/components/SearchField'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from './HierarchyTree.module.css'

/** A row's note where it shows no chips: a CREDIT agent's chips could not be read; any other names its scheme. Every
 *  non-CREDIT agent was called a "Revenue-sharing account", COMMISSION ones included (B001, AGE-17). */
const SCHEME_NOTES: Record<string, string> = {
  CREDIT: 'Chips not available',
  SHARING: 'Revenue-sharing account',
  COMMISSION: 'Commission account',
}
function schemeNote(schemeType?: string | null): string {
  return SCHEME_NOTES[String(schemeType || '').toUpperCase()] ?? 'Agent account'
}

export interface HierarchyTreeProps {
  agents: readonly HierarchyAgentNode[]
  loading?: boolean
  refreshing?: boolean
  error?: Error
  selectedAgentId?: string | null
  onRefresh: () => void
  onSelectAgent?: (agentId: string) => void
  onAction?: (action: 'edit' | 'suspend' | 'activate', agentId: string) => void
  /** After a deposit, withdrawal or credit reference change on a row's D / W / CR. */
  onChipsChanged?: () => void
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
  onChipsChanged,
}: HierarchyTreeProps) {
  const [searchValue, setSearchValue] = useState('')
  const { formatAmount } = useCurrency()
  const visibleAgents = useMemo(
    () => filterHierarchyAgents(agents, searchValue),
    [agents, searchValue],
  )

  // Chips are in the whitelabel currency, kept to 2 decimals (spec 2026-11-02 §2).
  const chipAmount = (chips: ChipAccount) => (value: number) => formatAmount(roundChips(value), chips.currency || undefined)

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
            const chips = isCredit ? agent.chips ?? null : null
            const chipFormat = chips ? chipAmount(chips) : null
            const refTone = chips ? chipTone(chips.refPnl) : undefined
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
                    {chips && chipFormat ? (
                      <span className={styles.chips}>
                        <span className={styles.chipLine}>
                          <span>Balance</span>
                          <strong>{chipFormat(chips.balance)}</strong>
                        </span>
                        <span className={styles.chipLine}>
                          <span>Ref P/L</span>
                          <strong className={refTone === 'gain' ? styles.gain : refTone === 'loss' ? styles.loss : undefined}>
                            {signedChips(chips.refPnl, chipFormat)}
                          </strong>
                        </span>
                      </span>
                    ) : (
                      <span className={styles.schemeNote}>{schemeNote(agent.schemeType)}</span>
                    )}
                  </button>

                  {/* D / W / CR render for the direct parent only (ChipActions checks it). */}
                  {chips ? <ChipActions account={chips} onDone={onChipsChanged} /> : null}

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
