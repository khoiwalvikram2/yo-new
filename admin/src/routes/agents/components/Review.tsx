import { useQuery } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import type { FormApi } from '@/ui/form/useForm'
import type { AgentEditorValues, AgentParentOption } from '../agentEditorModel'
import { PARENT_AGENT_QUERY } from './agentEditorQueries'
import styles from '../AgentEditor.module.css'

interface ParentData { agents: { agentsPage?: { items: AgentParentOption[] }; agentProfile?: AgentParentOption } }
export default function Review({ form }: { form: FormApi<AgentEditorValues> }) {
  const agent = useAuthStore((state) => state.agent)
  const values = form.values
  const { schemeType, parentAgentId } = values
  // The parent read by id, so a parent at any level (or beyond a list page) is named.
  const { data: parentData, loading: parentLoading } = useQuery<ParentData>(PARENT_AGENT_QUERY, { variables: { id: parentAgentId }, skip: !parentAgentId, errorPolicy: 'all' })
  const parent = parentData?.agents.agentProfile?.id === parentAgentId ? parentData?.agents.agentProfile : undefined
  const key = schemeType === 'COMMISSION' ? 'commissionRates' : 'sharingRates'
  const levelNames = ['Super Master', 'Master', 'Agent', 'Sub Agent']
  return <Card title="Review Agent Details" sub="Confirm the account settings before saving."><div className={styles.review}>
    <DescriptionList items={[
      { term: 'Username', value: values.username }, { term: 'Base Currency', value: values.currency },
      { term: 'Account Status', value: <StatusPill status={values.status}>{values.status}</StatusPill> },
      { term: 'Scheme Type', value: values.schemeType }, { term: 'Allowed Domains', value: values.allowedDomains.join(', ') || 'None (all products disabled)' },
      { term: 'Parent Agent', value: parentLoading ? 'Loading…' : parent?.username || (parentAgentId === agent?.id ? agent?.username : parentAgentId || 'Root') },
      { term: 'Hierarchy Level', value: values.levelIndex ? `L${values.levelIndex} ${levelNames[values.levelIndex - 1] || ''}` : '—' },
      ...values.allowedDomains.map((domain) => ({ term: `${domain[0].toUpperCase() + domain.slice(1)} ${schemeType === 'COMMISSION' ? 'Commission' : 'Share Rate'}`, value: `${Number(values[key][domain] || 0).toFixed(2)}%` })),
      ...(schemeType === 'CREDIT' && values.creditLimit != null ? [{ term: 'Credit Limit', value: Number(values.creditLimit).toFixed(2) }] : []),
      ...(schemeType === 'COMMISSION' ? [{ term: 'Cross-Domain Tally', value: values.tallyEnabled ? `ON: ${values.tallyDomains.join(', ')}` : 'OFF' }] : []),
    ]} />
  </div></Card>
}
