import { useEffect, useRef, useState } from 'react'
import { useQuery, useLazyQuery, gql } from '@apollo/client'
import type { DocumentNode } from 'graphql'
import { DIAL_CODES } from '@/shared/config/phoneCodes'
import { Card } from '@/ui/components/Card'
import { TextField } from '@/ui/components/TextField'
import { PasswordField } from '@/ui/components/PasswordField'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import { Button } from '@/ui/components/Button'
import { NumberField } from '@/ui/components/NumberField'
import type { FormApi } from '@/ui/form/useForm'
// The chips reads only, not the module's barrel: the form needs no chips component.
import { useChipAccount, useChipPool } from '@/modules/chips/chipHooks'
import { PLAYER_TYPES, givesOpeningChips, isAgentPlayer, phoneAvailabilityValue, type PlayerCreateValues } from '../playerCreateModel'
import styles from '../PlayerCreateForm.module.css'

const CREDIT_AGENTS_QUERY = gql`
  query CreditAgentsForPlayerCreate {
    agents {
      agentsPage(
        schemeType: CREDIT
        status: "ACTIVE"
        limit: 1000
        offset: 0
        includeStats: false
      ) {
        items {
          id
          username
          parentAgentId
          levelIndex
          schemeType
          status
        }
      }
    }
  }
`;

const SHARING_AGENTS_QUERY = gql`
  query SharingAgentsForPlayerCreate {
    agents {
      agentsPage(
        schemeType: SHARING
        status: "ACTIVE"
        limit: 1000
        offset: 0
        includeStats: false
      ) {
        items {
          id
          username
          parentAgentId
          levelIndex
          schemeType
          status
        }
      }
    }
  }
`;

const COMMISSION_AGENTS_QUERY = gql`
  query CommissionAgentsForPlayerCreate {
    agents {
      agentsPage(
        schemeType: COMMISSION
        status: "ACTIVE"
        limit: 1000
        offset: 0
        includeStats: false
      ) {
        items {
          id
          username
          parentAgentId
          levelIndex
          schemeType
          status
        }
      }
    }
  }
`;

const CHECK_PHONE_AVAILABLE_QUERY = gql`
  query CheckPhoneAvailable($phone: String!, $excludeUserId: Int) {
    checkPhoneAvailable(phone: $phone, excludeUserId: $excludeUserId) {
      available
      message
    }
  }
`;
/** An agent to own the player. */
interface AgentOption { id: string; username: string | null; parentAgentId?: string | null; levelIndex?: number | null; schemeType?: string | null; status?: string | null }
interface AgentsData { agents: { agentsPage: { items: AgentOption[] } } }
const agentDescription = (agent: AgentOption) => [`L${agent.levelIndex ?? 1}`, agent.schemeType ? agent.schemeType[0] + agent.schemeType.slice(1).toLowerCase() : null].filter(Boolean).join(' · ')
export default function BasicInfo({ form, agentMode = false, phoneQuery }: {
  form: FormApi<PlayerCreateValues>; tenant?: string | null; agentMode?: boolean; phoneQuery?: DocumentNode
}) {
  const { playerType, phone, dialCode } = form.values
  const { setValue } = form
  const previousType = useRef(playerType)
  useEffect(() => {
    // Another type has another owner, and its opening chips another source (the pool or an agent): both start over.
    if (previousType.current !== playerType) { setValue('agentId', ''); setValue('openingChips', null) }
    previousType.current = playerType
  }, [playerType, setValue])
  const credit = useQuery<AgentsData>(CREDIT_AGENTS_QUERY, { skip: agentMode || playerType !== 'AGENT_CREDIT' })
  const sharing = useQuery<AgentsData>(SHARING_AGENTS_QUERY, { skip: agentMode || playerType !== 'SHARING_AGENT_PLAYER' })
  const commission = useQuery<AgentsData>(COMMISSION_AGENTS_QUERY, { skip: agentMode || playerType !== 'COMMISSION_AGENT_PLAYER' })
  const selected = playerType === 'AGENT_CREDIT' ? credit : playerType === 'SHARING_AGENT_PLAYER' ? sharing : commission
  // Every ACTIVE agent of the scheme at any level, sub-agents included (the server filters on status; a stale row is kept out here too).
  const agents = (selected.data?.agents.agentsPage.items || []).filter((agent) => !agent.status || agent.status.toUpperCase() === 'ACTIVE')
  // A credit player's opening chips come from its direct parent only (spec 2026-11-02 §4.4, decision 3): the
  // whitelabel pool for a whitelabel credit player; for an agent credit player, its chosen CREDIT agent's own free
  // chips, the admin acting for that agent (owner decision 2026-11-04). Its Credit Reference and Opening Chips show
  // once that parent is known (givesOpeningChips).
  const agentId = form.values.agentId
  const opensWithChips = !agentMode && givesOpeningChips({ playerType, targetAgentId: form.values.targetAgentId, agentId }, false)
  const fromAgent = opensWithChips && playerType === 'AGENT_CREDIT'
  const pool = useChipPool({ skip: !opensWithChips || fromAgent })
  const parent = useChipAccount('AGENT', agentId, { skip: !fromAgent })
  // The chosen agent's figures only: never the agent chosen before it while the new read is on its way.
  const parentAccount = fromAgent && parent.account && parent.account.id.toLowerCase() === agentId.toLowerCase() ? parent.account : null
  const chipsFree = agentMode ? undefined : opensWithChips ? (fromAgent ? parentAccount?.available : pool.pool?.available) ?? null : null
  const parentName = agents.find((agent) => agent.id === agentId)?.username || parentAccount?.username || 'the agent'
  const { getValue } = form
  useEffect(() => {
    // Agent mode reads the agent's own chips in the form itself.
    if (chipsFree !== undefined && getValue('_chipsFree') !== chipsFree) setValue('_chipsFree', chipsFree)
  }, [chipsFree, getValue, setValue])
  const free = chipsFree != null ? ` (${Math.max(0, chipsFree).toFixed(2)} free)` : ''
  const [checking, setChecking] = useState(false)
  const [checkPhone] = useLazyQuery<{ checkPhoneAvailable: { available: boolean; message?: string } }>(phoneQuery || CHECK_PHONE_AVAILABLE_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' })
  useEffect(() => {
    let active = true
    setChecking(false); setValue('_phoneError', '')
    const normalized = phoneAvailabilityValue(phone, agentMode ? undefined : dialCode)
    if (!normalized || normalized.length < 6) return
    const timer = setTimeout(() => {
      setChecking(true)
      void checkPhone({ variables: { phone: normalized, excludeUserId: undefined } }).then((result) => {
        if (!active) return
        const availability = result.data?.checkPhoneAvailable
        setValue('_phoneError', availability && !availability.available ? availability.message || 'This phone number is already registered' : '')
      }).catch(() => { if (active) setValue('_phoneError', '') }).finally(() => { if (active) setChecking(false) })
    }, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [phone, dialCode, agentMode, setValue, checkPhone])
  return <Card title={agentMode ? 'Player Information' : 'Basic Information'}><div className={styles.stack}>
    {!agentMode && <Select label="Player Type" {...form.field('playerType')} options={PLAYER_TYPES} layout="stacked" required />}
    {!agentMode && isAgentPlayer(playerType) && <Combobox label={playerType === 'AGENT_CREDIT' ? 'Credit Agent' : playerType === 'SHARING_AGENT_PLAYER' ? 'Sharing Agent' : 'Commission Agent'}
      {...form.field('agentId')} value={form.values.agentId || null} onChange={(value) => setValue('agentId', value || '')} required loading={selected.loading}
      options={agents.map((agent) => ({ value: agent.id, label: agent.username || agent.id, description: agentDescription(agent) }))}
      help={playerType === 'AGENT_CREDIT' ? "Active agents at every level of the hierarchy. The player's opening chips come from this agent's chips." : 'Active agents at every level of the hierarchy.'} />}
    {!agentMode && isAgentPlayer(playerType) && selected.error && <Notice tone="error" title="Unable to load agents" action={<Button size="sm" onClick={() => void selected.refetch()}>Retry</Button>}>{selected.error.message}</Notice>}
    {opensWithChips && <div className={styles.fields}>
      <NumberField label="Credit Reference" {...form.field('creditLimit')} value={form.values.creditLimit ?? null} min={0} precision={2}
        help="Optional. A reference only: it moves no chips. The player's Ref P/L is its chips less this. Leave blank for 0." />
      <NumberField label="Opening Chips" {...form.field('openingChips')} value={form.values.openingChips ?? null} min={0} precision={2}
        help={`Optional. Deposited from ${fromAgent ? `${parentName}'s chips` : 'the whitelabel pool'}${free}.`} />
    </div>}
    <div className={styles.fields}>
      <TextField label="Full Name" {...form.field('name')} required placeholder="e.g., John Smith" />
      <TextField label="Username" {...form.field('username')} required={agentMode} help={agentMode ? 'Letters, numbers, and underscores. 3–50 characters.' : 'Leave empty to auto-generate'} />
      <div className={agentMode ? undefined : styles.phone}>
        {!agentMode && <Combobox label="Dial Code" {...form.field('dialCode')} options={DIAL_CODES.map((option) => ({ value: option.code, label: option.label }))}
          value={form.values.dialCode || null} onChange={(value) => setValue('dialCode', value || '')} />}
        <TextField label={agentMode ? 'Phone' : 'Phone Number'} {...form.field('phone')} required inputMode="numeric" maxLength={agentMode ? 10 : undefined}
          onChange={(value) => setValue('phone', value.replace(/[^0-9]/g, ''))} error={form.errors.phone || form.values._phoneError || undefined}
          help={checking ? 'Checking phone availability…' : agentMode ? 'Enter a 10-digit phone number' : 'Enter digits only (without country code or spaces)'} />
      </div>
      <TextField label={agentMode ? 'Email (Optional)' : 'Email Address'} {...form.field('email')} type="email" />
      <PasswordField label="Password" {...form.field('password')} autoComplete="new-password" required help="At least 8 characters" />
    </div>
    {!agentMode && <Switch label="Require Reset on Next Login" checked={form.values.requirePasswordReset} onChange={(value) => setValue('requirePasswordReset', value)} />}
  </div></Card>
}

