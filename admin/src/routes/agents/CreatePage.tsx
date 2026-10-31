import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { gql, useMutation } from '@apollo/client'
import { notify } from '@/shared/services/notification'
import { useAuthStore } from '@/shared/core/authStore'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { AgentEditor } from './AgentEditor'
import { createAgentInput, agentRateInputs, type AgentEditorValues, type AgentRateInput } from './agentEditorModel'
import styles from './AgentEditor.module.css'

const CreateAgentMutation = gql`
  mutation CreateAgent($input: CreateAgentInput!) {
    agents {
      createAgent(input: $input) {
        id
        username
        schemeType
      }
    }
  }
`;

const SetCommissionConfigMutation = gql`
  mutation SetCommissionConfig($input: SetCommissionConfigInput!) {
    agents {
      setCommissionConfig(input: $input) {
        id
        domain
        commissionRate
      }
    }
  }
`;

const SetSharingConfigMutation = gql`
  mutation SetSharingConfig($input: SetSharingConfigInput!) {
    agents {
      setSharingConfig(input: $input) {
        id
        domain
        shareRate
      }
    }
  }
`;

export default function CreateAgentPage() {
  return <RBACGuard required={[{ domain: 'agents.create', actions: ['view', 'create'] }]} bypassForAgents><CreateAgentContent /></RBACGuard>
}
/** An agent that exists but whose rates are not all saved yet: only those rate calls are retried, never the create. */
interface PendingSetup { id: string; username: string; schemeType: string; inputs: AgentRateInput[]; error: string }
const errorText = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback
function CreateAgentContent() {
  const navigate = useNavigate()
  const agent = useAuthStore((state) => state.agent)
  const [createAgent] = useMutation(CreateAgentMutation)
  const [setCommissionConfig] = useMutation(SetCommissionConfigMutation)
  const [setSharingConfig] = useMutation(SetSharingConfigMutation)
  const [pending, setPending] = useState<PendingSetup | null>(null)
  const [retrying, setRetrying] = useState(false)
  if (agent && agent.schemeType !== 'COMMISSION' && agent.levelIndex != null && agent.levelIndex >= 4)
    return <Page><PageHeader title="Cannot Create Agent" eyebrow="Agents" back={{ to: '/agents', label: 'Back to Agents' }} />
      <Notice tone="warn">Maximum hierarchy depth (4 levels) reached. You cannot create sub-agents.</Notice></Page>
  /** Saves each rate; returns the ones that failed (with the first error) so only they are retried. */
  async function saveRates(schemeType: string, inputs: AgentRateInput[]) {
    const results = await Promise.allSettled(inputs.map((input) => schemeType === 'COMMISSION' ?
      setCommissionConfig({ variables: { input } }) : setSharingConfig({ variables: { input } })))
    const failed = inputs.filter((_, index) => results[index].status === 'rejected')
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    return { failed, error: firstError ? errorText(firstError.reason, 'The rate could not be saved.') : '' }
  }
  function finish(id: string, schemeType: string, username: string, failed: AgentRateInput[], error: string) {
    if (!failed.length) {
      setPending(null)
      notify.success('Agent created successfully!')
      navigate('/agents', { replace: true })
      return
    }
    setPending({ id, username, schemeType, inputs: failed, error })
    notify.error(`Agent ${username} was created, but its rates were not saved: ${error}`)
  }
  async function save(values: AgentEditorValues) {
    let savedId: string | undefined
    try {
      const result = await createAgent({ variables: { input: createAgentInput(values, agent ?? undefined) } })
      savedId = result.data?.agents?.createAgent?.id as string | undefined
      if (!savedId) throw new Error('Failed to create agent. Agent ID not returned.')
    } catch (error) {
      // Nothing was created: the form keeps its values and can be submitted again.
      const message = errorText(error, 'Failed to create agent. Please try again.')
      notify.error(message)
      throw new Error(message)
    }
    const username = values.username.trim().toLowerCase()
    const { failed, error } = await saveRates(values.schemeType, agentRateInputs(savedId, values, new Date().toISOString()))
    finish(savedId, values.schemeType, username, failed, error)
  }
  async function retry() {
    if (!pending || retrying) return
    setRetrying(true)
    try {
      const { failed, error } = await saveRates(pending.schemeType, pending.inputs)
      finish(pending.id, pending.schemeType, pending.username, failed, error)
    } finally { setRetrying(false) }
  }
  if (pending) return <Page><PageHeader title="Finish Agent Setup" eyebrow="Agents" back={{ to: '/agents', label: 'Back to Agents' }}
    meta={pending.username} />
    <Notice tone="error" title="Rates not saved" action={<div className={styles.actions}>
      <Button variant="primary" loading={retrying} onClick={() => void retry()}>Retry saving rates</Button>
      <Link to={`/agents/${pending.id}/edit`} className={buttonClassName()}>Edit agent</Link>
    </div>}>
      {pending.inputs.length === 1 ? `The ${pending.inputs[0].domain} rate` : `${pending.inputs.length} rates (${pending.inputs.map((input) => input.domain).join(', ')})`} could not be saved: {pending.error}. Retrying saves only these rates; the agent is not created again.
    </Notice>
  </Page>
  return <AgentEditor onSave={save} />
}

