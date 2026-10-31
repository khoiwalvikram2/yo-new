import { useEffect, useId, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Drawer } from '@/ui/components/Drawer'
import { NumberField } from '@/ui/components/NumberField'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { toast } from '@/ui/components/toast'
import { GET_EVENT_RISK_CONFIG_QUERY, UPSERT_EVENT_RISK_CONFIG_MUTATION } from '@/lib/graphql/riskConfig'
import { ConfigChecks, ConfigNumbers } from './EventConfigFields'
import { AMOUNTS, PERCENTILES, WEIGHTS, configNumber, configRecord, riskDraftError, riskDraftFrom, weightTotal, type RiskDraft } from './eventConfigModel'
import styles from './EventConfig.module.css'

interface RiskConfigDrawerProps { open: boolean; onClose: () => void; eventId: string }
type RiskTab = 'weights' | 'percentiles' | 'amounts' | 'alerts'
const tabs = [{ value: 'weights', label: 'Weights' }, { value: 'percentiles', label: 'Percentiles' }, { value: 'amounts', label: 'Thresholds' }, { value: 'alerts', label: 'Alerts' }] as const
const levels = [['HIGH', 'High'], ['MEDIUM', 'Medium'], ['LOW', 'Low'], ['MINIMAL', 'Minimal']] as const

export function RiskConfigDrawer(props: RiskConfigDrawerProps) {
  return props.open ? <RiskConfigEditor key={props.eventId} {...props} /> : null
}
function RiskConfigEditor({ open, onClose, eventId }: RiskConfigDrawerProps) {
  const [tab, setTab] = useState<RiskTab>('weights')
  const [draft, setDraft] = useState<RiskDraft | null>(null)
  const [failure, setFailure] = useState('')
  const [pending, setPending] = useState(false)
  const initial = useRef<RiskDraft | null>(null)
  const flight = useRef(false)
  const alive = useRef(true)
  const prefix = useId()
  const { data, loading, error, refetch } = useQuery<{ eventRiskConfig?: unknown }>(GET_EVENT_RISK_CONFIG_QUERY, { variables: { eventId }, skip: !open || !eventId, errorPolicy: 'all' })
  const [save] = useMutation<{ upsertEventRiskConfig?: { id?: string; eventId?: string } | null }>(UPSERT_EVENT_RISK_CONFIG_MUTATION)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!eventId || loading || error || initial.current) return
    const value = data?.eventRiskConfig
    if (value && configRecord(value).eventId && String(configRecord(value).eventId) !== eventId) return
    initial.current = riskDraftFrom(value)
    setDraft(initial.current)
  }, [eventId, loading, error, data])
  const edit = (section: keyof RiskDraft, key: string, value: unknown) => setDraft(current => current ? { ...current, [section]: { ...current[section], [key]: value } } : current)
  async function submit() {
    if (!draft || flight.current || loading || error || !eventId) return
    const invalid = riskDraftError(draft)
    if (invalid) { setFailure(invalid); return }
    flight.current = true; setPending(true); setFailure('')
    try {
      const result = await save({ variables: { input: { eventId, percentiles: draft.percentiles || undefined, weights: draft.weights || undefined, amounts: draft.amounts || undefined, alerts: draft.alerts || undefined } } })
      const saved = result.data?.upsertEventRiskConfig
      if (result.errors?.length || !saved?.id || (saved.eventId && saved.eventId !== eventId)) throw new Error(result.errors?.[0]?.message || 'The server did not confirm the risk configuration save.')
      if (!alive.current) return
      toast({ tone: 'ok', message: 'Risk configuration saved.' })
      try { await refetch() } catch { if (alive.current) toast({ tone: 'warn', message: 'Saved, but the configuration could not be reloaded.' }) }
      if (alive.current) onClose()
    } catch (cause) {
      if (alive.current) setFailure(cause instanceof Error ? cause.message : 'Could not save risk configuration.')
    } finally {
      flight.current = false
      if (alive.current) setPending(false)
    }
  }
  const total = draft ? weightTotal(draft) : 0
  return <Drawer open={open} onOpenChange={next => { if (!next && !flight.current) onClose() }} dismissible={!pending} title="Risk Configuration" sub="Event-specific risk factors and alert settings." size="lg" footer={<div className={styles.footer}>
    <Button variant="ghost" disabled={!draft || pending} onClick={() => { setDraft(initial.current); setFailure('') }}>Reset edits</Button>
    <Button variant="ghost" disabled={pending} onClick={onClose}>Cancel</Button>
    <Button variant="primary" loading={pending} disabled={!draft || loading || Boolean(error) || !eventId} onClick={() => void submit()}>Apply Changes</Button>
  </div>}>
    <div className={styles.stack}>
      {failure && <p role="alert" className={styles.error}>{failure}</p>}
      {error && <div className={styles.stack}><p role="alert" className={styles.error}>Configuration could not be loaded: {error.message}</p><Button onClick={() => void refetch().catch(cause => setFailure(cause instanceof Error ? cause.message : 'Reload failed.'))}>Retry loading</Button></div>}
      {loading && !draft && <Spinner label="Loading risk configuration" />}
      {draft && <fieldset className={styles.formFields} disabled={pending || loading || Boolean(error)}>
        <div className={styles.stack}>
          <div className={styles.tabs}><Tabs label="Risk configuration sections" idPrefix={prefix} value={tab} onChange={setTab} items={tabs} /></div>
          <section role="tabpanel" id={tabPanelId(prefix, tab)} aria-labelledby={tabId(prefix, tab)} className={styles.stack}>
            {tab === 'weights' && <Card title="Risk factor weights" tools={<StatusPill tone={total === 100 ? 'ok' : 'warn'}>{total}% / 100%</StatusPill>}><div className={styles.stack}><p className={styles.note}>Weights must total exactly 100%. Reset edits restores the loaded configuration; it does not save.</p><ConfigNumbers fields={WEIGHTS} values={draft.weights} max={100} required onChange={(key, value) => edit('weights', key, value)} /></div></Card>}
            {tab === 'percentiles' && <Card title="Percentile thresholds"><div className={styles.stack}><p className={styles.note}>Optional thresholds. Leave blank for automatic calculation.</p><ConfigNumbers fields={PERCENTILES} values={draft.percentiles ?? {}} onChange={(key, value) => edit('percentiles', key, value)} /></div></Card>}
            {tab === 'amounts' && <Card title="Fixed amount thresholds"><div className={styles.stack}><p className={styles.note}>Optional fallback values when percentiles are unavailable. Values are saved in the existing event configuration units.</p><ConfigNumbers fields={AMOUNTS} values={draft.amounts ?? {}} onChange={(key, value) => edit('amounts', key, value)} /></div></Card>}
            {tab === 'alerts' && <Card title="Risk alerts"><div className={styles.stack}>
              <Switch label="Enable risk alerts" checked={Boolean(draft.alerts.enabled)} onChange={value => edit('alerts', 'enabled', value)} />
              <ConfigChecks legend="Trigger on risk levels" choices={levels} value={draft.alerts.triggerLevels} onChange={value => edit('alerts', 'triggerLevels', value)} />
              <Switch label="In-app notifications" checked={Boolean(draft.alerts.notificationEnabled)} onChange={value => edit('alerts', 'notificationEnabled', value)} />
              <Switch label="Banner alerts" checked={Boolean(draft.alerts.bannerEnabled)} onChange={value => edit('alerts', 'bannerEnabled', value)} />
              <Switch label="Sidebar indicator" checked={Boolean(draft.alerts.sidebarIndicatorEnabled)} onChange={value => edit('alerts', 'sidebarIndicatorEnabled', value)} />
              <NumberField label="Alert cooldown (seconds)" value={configNumber(draft.alerts.cooldownSeconds)} min={0} onChange={value => edit('alerts', 'cooldownSeconds', value)} />
            </div></Card>}
          </section>
        </div>
      </fieldset>}
    </div>
  </Drawer>
}
