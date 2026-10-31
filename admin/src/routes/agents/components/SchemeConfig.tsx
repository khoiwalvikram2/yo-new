import { useEffect, useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { Card } from '@/ui/components/Card'
import { NumberField } from '@/ui/components/NumberField'
import { Switch } from '@/ui/components/Switch'
import { CheckboxGroup } from '@/ui/components/CheckboxGroup'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { Meter } from '@/ui/components/Meter'
import type { FormApi } from '@/ui/form/useForm'
import type { AgentEditorValues, AgentParentOption, AgentRate, RateCaps } from '../agentEditorModel'
import { PARENT_AGENT_QUERY } from './agentEditorQueries'
import styles from '../AgentEditor.module.css'

const AgentsQuery = gql`
  query GetSharingAgents($schemeType: AgentScheme) {
    agents {
      agentsPage(schemeType: $schemeType, limit: 100, includeStats: false) {
        items {
          id
          username
          levelIndex
          schemeType
          allowedDomains
          sharingRates {
            domain
            rate
          }
        }
      }
    }
  }
`;

const SubAgentsQuery = gql`
  query GetSubAgents($parentAgentId: ID!) {
    agents {
      agentsPage(parentAgentId: $parentAgentId, limit: 100, includeStats: false) {
        items {
          id
          username
          levelIndex
          schemeType
          allowedDomains
          sharingRates {
            domain
            rate
          }
        }
      }
    }
  }
`;

const LoggedInAgentQuery = gql`
  query GetLoggedInAgent($id: ID!) {
    agents {
      agentProfile(id: $id) {
        id
        username
        levelIndex
        schemeType
        allowedDomains
        sharingRates {
          domain
          rate
        }
      }
    }
  }
`;

const WhitelabelQuery = gql`
  query GetWhitelabel($id: ID!) {
    whitelabel(id: $id) {
      id
      sharingRates {
        domain
        rate
      }
    }
  }
`;
interface ParentData { agents: { agentsPage?: { items: AgentParentOption[] }; agentProfile?: AgentParentOption } }
export default function SchemeConfig({ form, isEdit = false }: { form: FormApi<AgentEditorValues>; isEdit?: boolean }) {
  const agent = useAuthStore((state) => state.agent)
  const roles = useAuthStore((state) => state.roles)
  const { whitelabel } = useCurrentWhitelabel()
  const { schemeType, allowedDomains, parentAgentId, tallyEnabled } = form.values
  const { setValue, getValue } = form
  const isAgent = Boolean(agent && ['SHARING', 'CREDIT', 'COMMISSION'].includes(agent.schemeType))
  const isWhitelabelAdmin = roles.some((role) => role === 'Whitelabel Admin' || role.toLowerCase() === 'whitelabel_admin' || role.toLowerCase().includes('whitelabel'))
  const whitelabelQuerySkip = !isWhitelabelAdmin || !whitelabel?.id || whitelabel.id === 'default'
  const { data: whitelabelData, loading: whitelabelLoading, error: whitelabelError } = useQuery<{ whitelabel: { sharingRates?: AgentRate[] } }>(WhitelabelQuery, {
    variables: { id: whitelabel?.id || '' }, skip: whitelabelQuerySkip, fetchPolicy: 'network-only',
  })
  // Only a fallback for finding the parent when the by-id read has not answered; nothing to find without a parent.
  const { data: agentsData } = useQuery<ParentData>(AgentsQuery, {
    variables: { schemeType: schemeType === 'SHARING' || schemeType === 'CREDIT' ? schemeType : undefined }, skip: (schemeType !== 'SHARING' && schemeType !== 'CREDIT') || !parentAgentId, fetchPolicy: 'network-only',
  })
  const { data: loggedInAgentData } = useQuery<ParentData>(LoggedInAgentQuery, {
    variables: { id: agent?.id }, skip: !agent?.id || schemeType === 'COMMISSION' || (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT'),
  })
  const { data: subAgentsData } = useQuery<ParentData>(SubAgentsQuery, {
    variables: { parentAgentId: agent?.id }, skip: !agent?.id || schemeType === 'COMMISSION' || (agent.schemeType !== 'SHARING' && agent.schemeType !== 'CREDIT'),
  })
  const parentIdForRates = parentAgentId || (isAgent && agent?.id ? agent.id : null)
  const parentAgentQuerySkip = !parentIdForRates || !['SHARING', 'CREDIT', 'COMMISSION'].includes(schemeType)
  const { data: parentAgentData, loading: parentAgentLoading, error: parentAgentError } = useQuery<ParentData>(PARENT_AGENT_QUERY, {
    variables: { id: parentIdForRates }, skip: parentAgentQuerySkip, fetchPolicy: 'network-only',
  })
  const isParentRateLoading = isAgent && (parentAgentLoading || (!parentAgentData && !parentAgentQuerySkip) || (parentAgentQuerySkip && !parentIdForRates))
  const sharingAgents = useMemo(() => {
    let options = (agentsData?.agents.agentsPage?.items || []).filter((option) => option.schemeType === schemeType)
    if (agent && (agent.schemeType === 'SHARING' || agent.schemeType === 'CREDIT')) {
      const profile = loggedInAgentData?.agents.agentProfile
      const children = (subAgentsData?.agents.agentsPage?.items || []).filter((option) => option.schemeType === schemeType)
      options = profile?.schemeType === schemeType ? [profile, ...children] : agent.schemeType === schemeType ? [agent as AgentParentOption, ...children] : children
    }
    return options
  }, [agentsData, loggedInAgentData, subAgentsData, agent, schemeType])
  const parent = sharingAgents.find((option) => option.id === parentAgentId)
  const fetchedParent = parentAgentData?.agents.agentProfile
  const parentForRates = fetchedParent && (fetchedParent.id === parentAgentId || fetchedParent.id === agent?.id) ? fetchedParent : parent
  const caps = useMemo<RateCaps>(() => {
    const limits: RateCaps['limits'] = {}
    const missingWhitelabelDomains: string[] = []
    for (const domain of allowedDomains) {
      if (schemeType === 'COMMISSION') {
        const parentRate = parentForRates?.commissionRates?.find((rate) => rate.domain === domain)
        limits[domain] = parentRate ? Number(parentRate.rate) : isAgent ? 0 : null
      } else {
        const parentRate = parentForRates?.sharingRates?.find((rate) => rate.domain === domain)
        // whitelabel.sharingRates answers 0 for a domain that was never configured: 0 or absent both mean "not configured".
        const whitelabelRate = whitelabelData?.whitelabel.sharingRates?.find((rate) => rate.domain === domain && Number(rate.rate) > 0)
        limits[domain] = parentForRates ? parentRate?.rate ?? (isAgent ? 0 : 100) : isAgent ? 0 : isWhitelabelAdmin && whitelabelRate ? whitelabelRate.rate : 100
        if (!parentForRates && isWhitelabelAdmin && !whitelabelQuerySkip && !whitelabelRate) missingWhitelabelDomains.push(domain)
      }
    }
    // Until the whitelabel's rates are in, a root agent's caps are unknown: hold the rates rather than guess.
    const whitelabelPending = !parentForRates && schemeType !== 'COMMISSION' && !whitelabelQuerySkip && (whitelabelLoading || !whitelabelData)
    return { limits, blocked: isParentRateLoading || whitelabelPending, missingWhitelabelDomains: whitelabelPending ? [] : missingWhitelabelDomains }
  }, [allowedDomains, schemeType, parentForRates, isAgent, isWhitelabelAdmin, whitelabelData, whitelabelLoading, whitelabelQuerySkip, isParentRateLoading])
  useEffect(() => {
    if (JSON.stringify(getValue('_caps')) !== JSON.stringify(caps)) setValue('_caps', caps)
  }, [caps, setValue, getValue])
  useEffect(() => {
    // Tally is not touched here: a new agent defaults it in its initial values, and an edit keeps the stored setting.
    if (!isEdit && agent && agent.schemeType === schemeType && schemeType !== 'COMMISSION' && !getValue('parentAgentId')) setValue('parentAgentId', agent.id)
  }, [isEdit, schemeType, agent, setValue, getValue])
  const parentCredit = parentForRates?.creditAvailable
  // An agent cannot change a sub-agent's tally (the API refuses it); it is shown read-only.
  const tallyReadOnly = isEdit && isAgent
  const rateKey = schemeType === 'COMMISSION' ? 'commissionRates' : 'sharingRates'
  return <Card title="Scheme Configuration"><div className={styles.stack}>
    {!allowedDomains.length && (isEdit ? <Notice tone="info" title="All products disabled">Sports, Casino and Matka will be hidden for this agent branch. Existing settlements and refunds remain available.</Notice> : <Notice tone="warn" title="Select Allowed Domains">Please go back to the Basic Info step and select at least one Allowed Domain to configure rates.</Notice>)}
    {parentAgentError && <Notice tone="error" title="Parent rate configuration unavailable">{parentAgentError.message}</Notice>}
    {whitelabelError && !parentForRates && schemeType !== 'COMMISSION' && <Notice tone="error" title="Whitelabel sharing rates unavailable">{whitelabelError.message}. Rates cannot be checked against the whitelabel's sharing, so they cannot be saved yet.</Notice>}
    {isParentRateLoading && <Notice tone="warn">Please wait while we fetch the parent agent's rates to determine your maximum allowed rates.</Notice>}
    <div className={styles.rates}>{allowedDomains.map((domain) => {
      const rate = form.values[rateKey][domain] ?? null
      const maximum = caps.limits[domain] ?? 100
      return <Card key={domain} title={`${domain[0].toUpperCase() + domain.slice(1)} ${schemeType === 'COMMISSION' ? 'Commission' : 'Share Rate'}`} headingLevel={3}>
        <div className={styles.stack}>
          <NumberField label={`${domain[0].toUpperCase() + domain.slice(1)} ${schemeType === 'COMMISSION' ? 'commission' : 'sharing'} rate`} {...form.field(`${rateKey}.${domain}`)}
            value={rate} min={0} max={maximum} precision={2} step={0.1} suffix="%" required disabled={isParentRateLoading}
            help={caps.limits[domain] == null ? 'Rate must be between 0 and 100' : `Max: parent's rate (${maximum.toFixed(2)}%)`} />
          {caps.missingWhitelabelDomains.includes(domain) && <Notice tone="warn">Whitelabel has no sharing configured for {domain}. Cannot assign.</Notice>}
          {rate != null && <><span className={styles.secondary}>{schemeType === 'COMMISSION' ? 'Commission' : 'Share'}: {rate.toFixed(2)}%. Remaining: {maximum - rate >= 0 ? `${(maximum - rate).toFixed(2)}%` : '—'}</span>
            <Meter value={Math.min(rate, maximum)} /></>}
        </div>
      </Card>
    })}</div>
    {schemeType === 'CREDIT' && !isEdit && <Card title="Credit Limit" headingLevel={3} sub="Credit given to the agent when it is created">
      <NumberField label="Credit limit" {...form.field('creditLimit')} value={form.values.creditLimit} min={0} precision={2}
        help={`Optional. Leave blank to set it later from the agent's profile.${parentForRates ? parentCredit != null ? ` Taken from the parent's available credit (${Number(parentCredit).toFixed(2)}).` : ' Taken from the parent\'s available credit.' : ' Taken from the whitelabel credit pool.'}`} />
    </Card>}
    {schemeType === 'COMMISSION' && tallyReadOnly && <Card title="Cross-Domain Tally" headingLevel={3} sub="Combine commissions across selected domains">
      <p className={styles.secondary}>{tallyEnabled ? `On${form.values.tallyDomains.length ? `: ${form.values.tallyDomains.join(', ')}` : ''}` : 'Off'}. Only an administrator can change the tally.</p>
    </Card>}
    {schemeType === 'COMMISSION' && !tallyReadOnly && <Card title="Cross-Domain Tally" headingLevel={3} sub="Combine commissions across selected domains">
      <div className={styles.stack}>
        <Switch label="Cross-Domain Tally" checked={tallyEnabled} onChange={(value) => setValue('tallyEnabled', value)} />
        {tallyEnabled && <>
          <div className={styles.actions}><Button size="sm" aria-disabled={form.values.tallyDomains.length === allowedDomains.length} onClick={() => setValue('tallyDomains', [...allowedDomains])}>Select All</Button>
            <Button size="sm" aria-disabled={!form.values.tallyDomains.length} onClick={() => setValue('tallyDomains', [])}>Clear All</Button></div>
          <CheckboxGroup label="Select Domains for Tally" {...form.field('tallyDomains')} options={allowedDomains.map((domain) => ({ value: domain, label: domain[0].toUpperCase() + domain.slice(1) }))} orientation="horizontal" />
        </>}
      </div>
    </Card>}
  </div></Card>
}
