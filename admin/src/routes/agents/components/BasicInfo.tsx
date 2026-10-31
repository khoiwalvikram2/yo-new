import { useEffect, useMemo, useState } from 'react'
import { gql, useQuery, useLazyQuery } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { APP_CONFIG } from '@/lib/graphql/appConfig'
import { Card } from '@/ui/components/Card'
import { TextField } from '@/ui/components/TextField'
import { PasswordField } from '@/ui/components/PasswordField'
import { Select } from '@/ui/components/Select'
import { RadioGroup } from '@/ui/components/RadioGroup'
import { CheckboxGroup } from '@/ui/components/CheckboxGroup'
import { Combobox } from '@/ui/components/Combobox'
import { Notice } from '@/ui/components/Notice'
import type { FormApi } from '@/ui/form/useForm'
import { eligibleParentAgents, type AgentEditorValues, type AgentParentOption } from '../agentEditorModel'
import { PARENT_AGENT_QUERY } from './agentEditorQueries'
import styles from '../AgentEditor.module.css'

const CHECK_AGENT_USERNAME_AVAILABLE_QUERY = gql`
  query CheckAgentUsernameAvailable($username: String!, $excludeAgentId: String) {
    agents {
      checkAgentUsernameAvailable(username: $username, excludeAgentId: $excludeAgentId) {
        available
        message
      }
    }
  }
`;

// The admin's parent picker: every ACTIVE agent of the scheme, at any level (not only the roots).
const AgentsQuery = gql`
  query GetSharingAgentsForBasicInfo($schemeType: AgentScheme, $status: String) {
    agents {
      agentsPage(schemeType: $schemeType, status: $status, limit: 500, includeStats: false) {
        items {
          id
          username
          levelIndex
          schemeType
          status
          allowedDomains
          sharingRates { domain rate }
        }
      }
    }
  }
`;

const SubAgentsQuery = gql`
  query GetSubAgentsForBasicInfo($parentAgentId: ID!) {
    agents {
      agentsPage(parentAgentId: $parentAgentId, limit: 100) {
        items {
          id
          username
          levelIndex
          schemeType
          allowedDomains
          sharingRates { domain rate }
        }
      }
    }
  }
`;

const LoggedInAgentQuery = gql`
  query GetLoggedInAgentForBasicInfo($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        username
        levelIndex
        schemeType
        allowedDomains
        sharingRates { domain rate }
      }
    }
  }
`;
interface ParentData { agents: { agentsPage?: { items: AgentParentOption[] }; agentProfile?: AgentParentOption } }
export default function BasicInfo({ form, isEdit = false }: { form: FormApi<AgentEditorValues>; isEdit?: boolean }) {
  const agent = useAuthStore((state) => state.agent)
  const roles = useAuthStore((state) => state.roles)
  const { whitelabel } = useCurrentWhitelabel()
  const { getWhitelabelBaseCurrencyCode } = useCurrency()
  const isWhitelabelAdmin = roles.some((role) => role.toLowerCase().includes('whitelabel') || role.toLowerCase().includes('tenant'))
  const isAgent = Boolean(agent && ['SHARING', 'CREDIT', 'COMMISSION'].includes(agent.schemeType))
  const { schemeType, parentAgentId, username } = form.values
  const { setValue, setValues, getValue } = form
  const [usernameChecking, setUsernameChecking] = useState(false)
  // Only an admin creating an agent picks a parent; agents always create under themselves.
  const pickParent = !isAgent && !isEdit
  const { data: agentsData, loading: agentsLoading, error: agentsError } = useQuery<ParentData>(AgentsQuery, {
    variables: { schemeType: schemeType || 'COMMISSION', status: 'ACTIVE' }, skip: !schemeType || !pickParent, errorPolicy: 'all',
  })
  // The chosen (or existing) parent read by id, so its domains and level apply even when it is not in the picker's list.
  const { data: parentData } = useQuery<ParentData>(PARENT_AGENT_QUERY, { variables: { id: parentAgentId }, skip: !parentAgentId, errorPolicy: 'all' })
  const { data: subAgentsData } = useQuery<ParentData>(SubAgentsQuery, {
    variables: { parentAgentId: agent?.id ?? '' }, skip: !agent?.id || (schemeType !== 'COMMISSION' && agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT'),
  })
  const { data: loggedInAgentData } = useQuery<ParentData>(LoggedInAgentQuery, {
    variables: { id: agent?.id }, skip: !agent?.id || (schemeType !== 'COMMISSION' && agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT'),
  })
  const sharingAgents = useMemo(() => {
    let options = (agentsData?.agents.agentsPage?.items || []).filter((option) => option.schemeType === schemeType)
    if (isAgent && agent) {
      const profile = loggedInAgentData?.agents.agentProfile
      const children = (subAgentsData?.agents.agentsPage?.items || []).filter((option) => option.schemeType === schemeType)
      options = profile?.schemeType === schemeType ? [profile, ...children] : agent.schemeType === schemeType ?
        [{ id: agent.id, username: agent.username || agent.id, levelIndex: agent.levelIndex, schemeType: agent.schemeType, allowedDomains: agent.allowedDomains }, ...children] : children
    }
    return options
  }, [agentsData, subAgentsData, loggedInAgentData, isAgent, agent, schemeType])
  const fetchedParent = parentData?.agents.agentProfile
  const selectedParent = fetchedParent && fetchedParent.id === parentAgentId ? fetchedParent : sharingAgents.find((option) => option.id === parentAgentId)
  const parentLevel = selectedParent?.levelIndex ?? 0
  const parentOptions = useMemo(() => eligibleParentAgents(sharingAgents, schemeType).map((option) => ({
    value: option.id, label: option.username || option.id,
    description: `L${option.levelIndex ?? 1} · ${option.schemeType[0]}${option.schemeType.slice(1).toLowerCase()}`,
  })), [sharingAgents, schemeType])
  function chooseParent(id: string | null) {
    const parent = id ? sharingAgents.find((option) => option.id === id) : undefined
    setValues({ parentAgentId: id || null, levelIndex: parent ? (parent.levelIndex ?? 1) + 1 : 1 })
  }
  function chooseScheme(value: AgentEditorValues['schemeType']) {
    // A parent must share the scheme, so a scheme change starts again from a top-level agent.
    setValues({ schemeType: value, parentAgentId: null, levelIndex: 1, tallyEnabled: value === 'COMMISSION' })
  }
  const availableDomains = useMemo(() => selectedParent ? selectedParent.allowedDomains || [] :
    isAgent && agent ? agent.allowedDomains : ['sports', 'casino', 'matka'], [selectedParent, isAgent, agent])
  const { data: appConfigData } = useQuery<{ appConfig: { baseCurrency?: string } }>(APP_CONFIG, { errorPolicy: 'all', skip: !isWhitelabelAdmin })
  const baseCurrency = isWhitelabelAdmin ? appConfigData?.appConfig.baseCurrency || 'INR' : whitelabel?.id ? getWhitelabelBaseCurrencyCode() : 'INR'
  useEffect(() => {
    if (isEdit) return
    if (agent && isAgent) {
      const lockedScheme = agent.schemeType as AgentEditorValues['schemeType']
      if (lockedScheme !== getValue('schemeType')) setValue('schemeType', lockedScheme)
      if (getValue('parentAgentId') !== agent.id) setValue('parentAgentId', agent.id)
      const level = getValue('levelIndex')
      if (!level || level <= (agent.levelIndex || 1)) setValue('levelIndex', (agent.levelIndex || 1) + 1)
    } else if (getValue('parentAgentId') == null && getValue('levelIndex') == null) {
      // An admin's new agent starts at the top (L1). A chosen parent is kept when the step is revisited.
      setValue('levelIndex', 1)
    }
  }, [isEdit, isAgent, agent, setValue, getValue])
  useEffect(() => {
    if (!isEdit && getValue('currency') !== baseCurrency) setValue('currency', baseCurrency)
  }, [isEdit, baseCurrency, setValue, getValue])
  useEffect(() => {
    if (getValue('_parentLevel') !== parentLevel) setValue('_parentLevel', parentLevel)
    const current = getValue('allowedDomains')
    const valid = current.filter((domain) => availableDomains.includes(domain))
    if (valid.length !== current.length) setValue('allowedDomains', valid)
  }, [parentLevel, availableDomains, getValue, setValue])
  const [checkUsername] = useLazyQuery<{ agents: { checkAgentUsernameAvailable: { available: boolean; message?: string } } }>(CHECK_AGENT_USERNAME_AVAILABLE_QUERY, { fetchPolicy: 'network-only', errorPolicy: 'all' })
  useEffect(() => {
    let active = true
    setUsernameChecking(false)
    setValue('_usernameError', '')
    if (isEdit || username.trim().length < 3 || !/^[a-z0-9_]+$/.test(username)) return
    const timer = setTimeout(() => {
      setUsernameChecking(true)
      void checkUsername({ variables: { username: username.trim().toLowerCase(), excludeAgentId: undefined } }).then((result) => {
        if (!active) return
        const availability = result.data?.agents.checkAgentUsernameAvailable
        setValue('_usernameError', availability && !availability.available ? availability.message || 'This username is already taken' : '')
      }).catch(() => { if (active) setValue('_usernameError', '') }).finally(() => { if (active) setUsernameChecking(false) })
    }, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [username, isEdit, setValue, checkUsername])
  return <Card title="Basic Agent Information"><div className={styles.stack}>
    <div className={styles.fields}>
      <TextField label="Username" {...form.field('username')} disabled={isEdit} required={!isEdit} placeholder="e.g., agent_john"
        error={form.errors.username || form.values._usernameError} help={isEdit ? 'Username cannot be changed' : usernameChecking ? 'Checking availability…' : 'Must be unique. Only lowercase letters, numbers, and underscore.'} />
      {!isEdit && <PasswordField label="Password" {...form.field('password')} autoComplete="new-password" required placeholder="Enter password" />}
      <TextField label="Phone Number" {...form.field('phone')} disabled={isEdit} placeholder="e.g., +1234567890" help={isEdit ? 'Use profile controls to update contact details.' : 'Optional contact phone number for the agent'} />
      <TextField label="Base Currency" value={baseCurrency} onChange={() => undefined} disabled help={`Set to your whitelabel's base currency: ${baseCurrency}`} />
      <Select label="Account Status" {...form.field('status')} layout="stacked" required options={[
        { value: 'ACTIVE', label: 'Active - Can login & operate' }, { value: 'INACTIVE', label: 'Inactive - Limited access' }, { value: 'SUSPENDED', label: 'Suspended - No access' },
      ]} />
    </div>
    {/* The scheme is fixed once the agent exists: its rates, settlements and players all follow it. */}
    {!isAgent && <RadioGroup label="Scheme Type" {...form.field('schemeType')} onChange={chooseScheme} disabled={isEdit} orientation="vertical" required
      help={isEdit ? 'The scheme cannot be changed after the agent is created.' : undefined} options={[
      { value: 'SHARING', label: 'Sharing', description: 'Players deposit/withdraw themselves via app. Earn percentage share of GGR revenue.' },
      { value: 'CREDIT', label: 'Credit', description: 'Agent manages all D/W and credit limits. Players cannot deposit/withdraw via app.' },
      { value: 'COMMISSION', label: 'Commission', description: 'Earn commission on player activity.' },
    ]} />}
    {isAgent && <Notice tone="info">Scheme: {schemeType}. Sub-agents use the same revenue model.</Notice>}
    {pickParent && <Combobox label="Parent agent" value={parentAgentId} onChange={(value) => chooseParent(value)} options={parentOptions} clearable
      loading={agentsLoading} placeholder="None (top-level agent)" emptyText="No eligible agents" error={agentsError ? `Agents could not be loaded: ${agentsError.message}` : undefined}
      help={`Optional. Leave empty for a top-level agent. Lists active ${schemeType.toLowerCase()} agents${schemeType === 'COMMISSION' ? '' : ' below level 4'}.`} />}
    {schemeType !== 'COMMISSION' && !isEdit && <Select label="Hierarchy Level" layout="stacked" value={String(form.values.levelIndex || '')}
      onChange={(value) => setValue('levelIndex', Number(value))} required error={form.errors.levelIndex}
      help={parentLevel > 0 ? `Parent is L${parentLevel}, select L${parentLevel + 1} or higher (auto-filled)` : 'Root — typically L1 (Super Master)'}
      options={['Super Master', 'Master', 'Agent', 'Sub Agent'].map((label, index) => ({ value: String(index + 1), label: `L${index + 1} ${label}`, disabled: parentLevel > 0 && index + 1 <= parentLevel }))} />}
    {availableDomains.length < 3 && <Notice tone="info" title="Domain restriction">Only the selected parent's domains are available: {availableDomains.join(', ')}</Notice>}
    <CheckboxGroup label="Allowed Domains" {...form.field('allowedDomains')} orientation="horizontal" required={!isEdit}
      help="Controls product visibility and new bets for this agent's players and sub-agents." options={availableDomains.map((domain) => ({ value: domain, label: domain[0].toUpperCase() + domain.slice(1) }))} />
  </div></Card>
}
