import { useId } from 'react'
import { Button } from '@/ui/components/Button'
import { Tabs } from '@/ui/components/Tabs'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import { Card } from '@/ui/components/Card'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import type { FormApi } from '@/ui/form/useForm'
import { DOMAINS, tabsFor, type ConfigValues, type SettingsTab, type SettingsVariant } from './settingsModel'
import styles from './SportsConfiguration.module.css'
const tabLabels: Record<SettingsTab, string> = { stake: 'Stake Limits', delays: 'Bet Delays', odds: 'Odds Limits', cashout: 'Cashout', commission: 'Commission', exposure: 'Exposure Limits', risk: 'Risk & Alerts' }
interface Props { form: FormApi<ConfigValues>; variant: SettingsVariant; tab: SettingsTab; onTab: (tab: SettingsTab) => void; tier: string; onTier: (value: string) => void; tiers: { label: string; value: string }[]; currencySymbol: string; active: boolean; onActive: (value: boolean) => void; bulk: boolean; busy?: boolean }
export function SettingsEditor({ form, variant, tab, onTab, tier, onTier, tiers, currencySymbol, active, onActive, bulk, busy }: Props) {
  const prefix = useId()
  const name = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)
  const numeric = (key: string, label: string, min = 0, max?: number, step = 1, unit?: string, placeholder?: string) => <NumberField key={key} label={label} value={typeof form.values[key] === 'number' ? form.values[key] as number : null} onChange={value => form.setValue(key, value)} min={min} max={max} step={step} prefix={unit === 'money' ? currencySymbol : undefined} suffix={unit === '%' || unit === 'sec' ? unit : undefined} placeholder={placeholder} error={form.errors[key]} />
  return <fieldset disabled={busy} className={styles.fieldset}><div className={styles.stack}>
    <div className={styles.row}><div><div className={styles.name}>{bulk ? 'Bulk status' : 'Active state'}</div><p className={styles.secondary}>{bulk ? 'Set status for all selected records' : 'Enable or disable this record'}</p></div>{bulk ? <div className={styles.actions}><Button size="sm" variant={active ? 'primary' : 'secondary'} onClick={() => onActive(true)}>Activate all</Button><Button size="sm" variant={!active ? 'dangerSolid' : 'danger'} onClick={() => onActive(false)}>Suspend all</Button></div> : <Switch label="Active state" hideLabel checked={active} onChange={onActive} />}</div>
    <Card title="Apply Settings" headingLevel={3}>
      <div className={styles.two}><Select label="Apply Mode" layout="stacked" value={typeof form.values.mode === 'string' ? form.values.mode : variant === 'league' ? 'replace' : 'overwrite'} onChange={value => form.setValue('mode', value)} options={variant === 'league' ? [{ label: 'Overwrite unchanged', value: 'replace' }, { label: 'Fill Empty', value: 'fill-empty' }] : [{ label: 'Overwrite unchanged', value: 'overwrite' }, { label: 'Only set where empty', value: 'fill-empty' }, ...(variant === 'sport' ? [{ label: 'Replace all', value: 'replace-all' }] : [])]} help={variant === 'sport' ? 'Overwrite unchanged updates differing values; Only set where empty fills empty/null fields; Replace all forces values on all selected records. All changes are audited.' : 'Overwrite unchanged updates differing values; Fill Empty updates only empty/null fields. All changes are audited.'} />
      <Select label="VIP Tier" layout="stacked" value={tier} onChange={onTier} options={tiers} help="Default applies global/base settings. Tier values override Default where provided; unspecified fields inherit. Bulk changes use the selected tier." /></div>
    </Card>
    <Tabs label="Settings sections" idPrefix={prefix} value={tab} items={tabsFor(variant).map(value => ({ value, label: tabLabels[value] }))} onChange={onTab} className={styles.tabs} />
    <div role="tabpanel" id={tabPanelId(prefix, tab)} aria-labelledby={tabId(prefix, tab)} className={styles.stack}>
      {tab === 'stake' && DOMAINS.map(domain => <div key={domain}><h3 className={styles.name}>{name(domain)}</h3><div className={styles.two}>{numeric(domain + 'MinStake', name(domain) + ' Min Stake', 0, undefined, .01, 'money', '1.00')}{numeric(domain + 'MaxStake', name(domain) + ' Max Stake', 0, undefined, .01, 'money', '10000')}</div></div>)}
      {tab === 'delays' && DOMAINS.map(domain => <div key={domain}><h3 className={styles.name}>{name(domain)}</h3><div className={styles.two}>{numeric(domain + 'Delay', name(domain) + ' Delay (seconds)', 0, undefined, 1, 'sec', '0')}{numeric(domain + 'Cooldown', name(domain) + ' Cooldown (seconds)', 0, undefined, 1, 'sec', '0')}</div></div>)}
      {tab === 'odds' && <div className={styles.two}>{numeric('exchangeMinOdds','Min Odds',0,undefined,.01,undefined,'1.01')}{numeric('exchangeMaxOdds','Max Odds',0,undefined,.01,undefined,'1000')}</div>}
      {tab === 'cashout' && <><Switch label="Enable cashout" checked={!!form.values.cashoutActive} onChange={value => form.setValue('cashoutActive', value)} /><Notice>Allow players to cash out their bets before settlement.</Notice></>}
      {tab === 'commission' && DOMAINS.map(domain => <div key={domain}>{numeric(domain + 'Commission',name(domain) + ' Commission %',0,100,.1,'%', '1.5')}</div>)}
      {tab === 'exposure' && DOMAINS.map(domain => <div key={domain}><h3 className={styles.name}>{name(domain)}</h3><div className={styles.three}>{numeric(domain + 'ExposureDaily',name(domain) + ' Daily Limit',0,undefined,1,'money','50000')}{numeric(domain + 'ExposureWeekly',name(domain) + ' Weekly Limit',0,undefined,1,'money','200000')}{numeric(domain + 'ExposureCap',name(domain) + ' Exposure Cap',0,undefined,1,'money','1000000')}</div></div>)}
      {tab === 'risk' && <><div className={styles.three}><Select label="Risk Level" layout="stacked" value={typeof form.values.riskLevel === 'string' ? form.values.riskLevel : ''} onChange={value => form.setValue('riskLevel', value)} placeholder="Select level" options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />{numeric('riskThreshold','Risk Threshold',0,100,.1,'%','75')}{numeric('volatilityThreshold','Volatility Threshold',0,100,.1,'%','30')}</div><Switch label="Alert when thresholds are breached" checked={!!form.values.alertOnBreach} onChange={value => form.setValue('alertOnBreach', value)} /><div className={styles.two}><Select label="Alert Channel" layout="stacked" value={typeof form.values.alertChannel === 'string' ? form.values.alertChannel : ''} onChange={value => form.setValue('alertChannel', value)} placeholder="Select channel" options={variant === 'league' ? [{ label: 'Email', value: 'email' }] : [{ label: 'Slack', value: 'slack' }, { label: 'Email', value: 'email' }, { label: 'Webhook', value: 'webhook' }]} />{numeric('alertRateLimit','Rate Limit (alerts/min)',variant === 'sport' ? 1 : 0,120,1,undefined,'10')}</div></>}
    </div>
    {form.formError && <Notice tone="error" live="assertive">{form.formError}</Notice>}
  </div></fieldset>
}
