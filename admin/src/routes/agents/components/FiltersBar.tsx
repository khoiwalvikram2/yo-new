import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Combobox } from '@/ui/components/Combobox'
import styles from './AgentsSearchComponents.module.css'

type AgentOption = {
  id: string;
  username?: string | null;
};

type FiltersBarProps = {
  query: string;
  status: string;
  onChangeQuery: (v: string) => void;
  onChangeStatus: (v: string) => void;
  onClearAll: () => void;
  // Agent Selector props
  schemeType: string;
  selectedParentAgentId?: string;
  onChangeParentAgent: (v: string | undefined) => void;
  agentsForSelector: AgentOption[];
  loggedInAgentId?: string; // For identifying logged-in agent in the list
};

export function FiltersBar({
  query,
  status,
  onChangeQuery,
  onChangeStatus,
  onClearAll,
  schemeType,
  selectedParentAgentId,
  onChangeParentAgent,
  agentsForSelector,
}: FiltersBarProps) {
  const count = [query, status, selectedParentAgentId].filter(Boolean).length
  return <FilterBar label="Agent filters" activeCount={count} onClearAll={onClearAll} search={<SearchField label="Search agents" placeholder="Search name, phone or agent ID…" value={query} onChange={onChangeQuery} />}>
    <Combobox hideLabel className={styles.filter} label="Status" placeholder="All Status" clearable searchable={false} value={status || null} onChange={value => onChangeStatus(value || '')} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'SUSPENDED', label: 'Suspended' }]} />
    {schemeType !== 'COMMISSION' && <Combobox hideLabel className={styles.filter} label="Parent agent" placeholder="Filter by agent" clearable value={selectedParentAgentId || null} onChange={value => onChangeParentAgent(value || undefined)} options={agentsForSelector.map(agent => ({ value: agent.id, label: agent.username || agent.id }))} />}
  </FilterBar>
}
