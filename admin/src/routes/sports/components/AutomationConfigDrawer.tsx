import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Drawer } from '@/ui/components/Drawer'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { Spinner } from '@/ui/components/Spinner'
import { Switch } from '@/ui/components/Switch'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { toast } from '@/ui/components/toast'
import { GET_AUTOMATION_RULES_QUERY, UPSERT_AUTOMATION_RULE_MUTATION } from '@/lib/graphql/automationRules'
import { ConfigChecks, ConfigNumbers } from './EventConfigFields'
import { automationDraftError, automationDraftFrom, configNumber, configRecord, type AutomationDraft } from './eventConfigModel'
import styles from './EventConfig.module.css'

interface AutomationConfigDrawerProps { open: boolean; onClose: () => void; eventId: string }
type AutomationTab = 'autoVoid' | 'marketMaker' | 'patternDetection'
const tabs = [{ value: 'autoVoid', label: 'Auto-Void' }, { value: 'marketMaker', label: 'Market Maker' }, { value: 'patternDetection', label: 'Pattern Detection' }] as const
const patterns = [['RAPID_BETTING', 'Rapid Betting'], ['MULTI_ACCOUNT', 'Multi-Account'], ['COORDINATED', 'Coordinated'], ['UNUSUAL_STAKE', 'Unusual Stake'], ['ODD_TIMING', 'Odd Timing'], ['AGENT_COLLUSION', 'Agent Collusion'], ['HIGH_ODDS', 'High Odds']] as const
const actions = [['FLAG', 'Flag Player'], ['VOID', 'Void Bet'], ['NOTIFY', 'Notify Admin']] as const

export function AutomationConfigDrawer(props: AutomationConfigDrawerProps) {
  return props.open ? <AutomationConfigEditor key={props.eventId} {...props} /> : null
}
function AutomationConfigEditor({ open, onClose, eventId }: AutomationConfigDrawerProps) {
  const [tab, setTab] = useState<AutomationTab>('autoVoid')
  const [draft, setDraft] = useState<AutomationDraft | null>(null)
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const initial = useRef<AutomationDraft | null>(null)
  const flight = useRef(false)
  const alive = useRef(true)
  const prefix = useId()
  const { data, loading, error, refetch } = useQuery<{ automationRules?: unknown[] }>(GET_AUTOMATION_RULES_QUERY, { variables: { eventId }, skip: !open || !eventId, errorPolicy: 'all' })
  const [save] = useMutation<{ upsertAutomationRule?: { success?: boolean; message?: string } | null }>(UPSERT_AUTOMATION_RULE_MUTATION)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!eventId || loading || error || initial.current) return
    const first = data?.automationRules?.[0]
    if (first && configRecord(first).eventId && String(configRecord(first).eventId) !== eventId) return
    initial.current = automationDraftFrom(first)
    setDraft(initial.current)
  }, [eventId, loading, error, data])
  const edit = (key: string, value: unknown) => setDraft(current => current ? { ...current, config: { ...current.config, [key]: value } } : current)
  const editTrigger = (key: string, value: unknown) => setDraft(current => current ? { ...current, config: { ...current.config, triggers: { ...configRecord(current.config.triggers), [key]: value } } } : current)
  async function submit() {
    if (!draft || flight.current || loading || error || !eventId) return
    const invalid = automationDraftError(draft)
    if (invalid) { setFailure(invalid); return }
    flight.current = true; setPending(true); setFailure('')
    try {
      const result = await save({ variables: { input: { eventId, ruleType: draft.ruleType, config: draft.config || {}, enabled: draft.enabled !== undefined ? draft.enabled : true, priority: draft.priority || 0 } } })
      const saved = result.data?.upsertAutomationRule
      if (result.errors?.length || saved?.success !== true) throw new Error(saved?.message || result.errors?.[0]?.message || 'The server did not confirm the automation rule save.')
      if (!alive.current) return
      initial.current = draft
      toast({ tone: 'ok', message: 'Automation rule saved.' })
      try { await refetch() } catch { if (alive.current) toast({ tone: 'warn', message: 'Saved, but the rules could not be reloaded.' }) }
    } catch (cause) {
      if (alive.current) setFailure(cause instanceof Error ? cause.message : 'Could not save automation rule.')
    } finally {
      flight.current = false
      if (alive.current) setPending(false)
    }
  }
  const triggers = configRecord(draft?.config.triggers)
  const riskLevel = typeof triggers.riskLevel === 'string' ? triggers.riskLevel : ''
  const riskOptions = [{ value: 'HIGH', label: 'High' }, { value: 'CRITICAL', label: 'Critical' }, ...(riskLevel && !['HIGH', 'CRITICAL'].includes(riskLevel) ? [{ value: riskLevel, label: riskLevel }] : [])]
  return <Drawer open={open} onOpenChange={next => { if (!next && !flight.current) onClose() }} dismissible={!pending} title="Automation Configuration" sub="Edit the first loaded rule for this event." size="lg" footer={<div className={styles.footer}>
    <Button variant="ghost" disabled={!draft || pending} onClick={() => { setDraft(initial.current); setFailure('') }}>Reset edits</Button>
    <Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
    <Button variant="primary" loading={pending} disabled={!draft || loading || Boolean(error) || !eventId} onClick={() => void submit()}>Apply Changes</Button>
  </div>}>
    <div className={styles.stack}>
      {failure && <p role="alert" className={styles.error}>{failure}</p>}
      {error && <div className={styles.stack}><p role="alert" className={styles.error}>Rules could not be loaded: {error.message}</p><Button onClick={() => void refetch().catch(cause => setFailure(cause instanceof Error ? cause.message : 'Reload failed.'))}>Retry loading</Button></div>}
      {loading && !draft && <Spinner label="Loading automation rules" />}
      {draft && <fieldset className={styles.formFields} disabled={pending || loading || Boolean(error)}>
        <div className={styles.stack}>
          <p className={styles.note}>Rule type: {draft.ruleType}. Rule status: {draft.enabled === undefined ? 'server default' : draft.enabled ? 'enabled' : 'disabled'}. These sections edit the same rule configuration, not separate rules. The loaded top-level status and priority are preserved; section switches only change configuration settings.</p>
          <div className={styles.tabs}><Tabs label="Automation configuration sections" idPrefix={prefix} value={tab} onChange={setTab} items={tabs} /></div>
          <section role="tabpanel" id={tabPanelId(prefix, tab)} aria-labelledby={tabId(prefix, tab)} className={styles.stack}>
            {tab === 'autoVoid' && <Card title="Auto-Void rules"><div className={styles.stack}>
              <Switch label="Enable Auto-Void" checked={Boolean(draft.config.enabled)} onChange={value => edit('enabled', value)} />
              <ConfigNumbers fields={[['stakeThreshold', 'Stake threshold']]} values={triggers} onChange={editTrigger} />
              <ConfigChecks legend="Trigger pattern types" choices={patterns.slice(0, 4)} value={triggers.patternTypes} onChange={value => editTrigger('patternTypes', value)} />
              <Select label="Risk level" layout="stacked" placeholder="Select risk level" options={riskOptions} value={riskLevel} onChange={value => editTrigger('riskLevel', value)} />
              <NumberField label="Automation cooldown (seconds)" value={configNumber(draft.config.cooldown)} min={0} onChange={value => edit('cooldown', value)} />
            </div></Card>}
            {tab === 'marketMaker' && <Card title="Market Maker settings"><div className={styles.stack}>
              <Switch label="Enable Market Maker" checked={Boolean(draft.config.enabled)} onChange={value => edit('enabled', value)} />
              <ConfigNumbers fields={[['bookBalanceThreshold', 'Minimum book balance'], ['maxExposure', 'Accept if exposure below']]} values={triggers} onChange={editTrigger} />
              <p className={styles.note}>This switch uses the same configuration enabled field as Auto-Void, matching the existing rule contract.</p>
            </div></Card>}
            {tab === 'patternDetection' && <Card title="Pattern Detection settings"><div className={styles.stack}>
              <ConfigChecks legend="Enabled pattern detectors" choices={patterns} value={draft.config.enabledPatterns} onChange={value => edit('enabledPatterns', value)} />
              <ConfigChecks legend="Actions on detection" choices={actions} value={draft.config.actionsOnDetection} onChange={value => edit('actionsOnDetection', value)} />
            </div></Card>}
          </section>
        </div>
      </fieldset>}
    </div>
  </Drawer>
}

