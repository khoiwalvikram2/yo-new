import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { APP_CONFIG, UPDATE_APP_CONFIG } from '@/lib/graphql/appConfig'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { notify } from '@/shared/services/notification'
import { Drawer } from '@/ui/components/Drawer'
import { Button } from '@/ui/components/Button'
import { NumberField } from '@/ui/components/NumberField'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { useSettingsForm } from './useSettingsForm'
import { DOMAINS, defaultStakeLimitsError, type ConfigValues } from './settingsModel'
import styles from './SportsConfiguration.module.css'
interface Defaults { defaultStakeLimits?: Partial<Record<'exchangeMin' | 'exchangeMax' | 'bookmakerMin' | 'bookmakerMax' | 'fancyMin' | 'fancyMax', number | null>>; defaultBetDelays?: Partial<Record<'exchange' | 'bookmaker' | 'fancy', number | null>>; defaultBetCooldowns?: Partial<Record<'exchange' | 'bookmaker' | 'fancy', number | null>> }
const EMPTY: Defaults = {}
function defaults(source: Defaults): ConfigValues {
  return Object.fromEntries(DOMAINS.flatMap(domain => [
    [domain + 'Min', source.defaultStakeLimits?.[(domain + 'Min') as keyof NonNullable<Defaults['defaultStakeLimits']>] || 10],
    [domain + 'Max', source.defaultStakeLimits?.[(domain + 'Max') as keyof NonNullable<Defaults['defaultStakeLimits']>] || 100000],
    [domain + 'Delay', source.defaultBetDelays?.[domain] ?? 0],
    [domain + 'Cooldown', source.defaultBetCooldowns?.[domain] ?? 0],
  ]))
}
export function DefaultStakeLimitsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { form, methods } = useSettingsForm()
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const { getCurrencySymbol } = useCurrency()
  const { data, loading, refetch, error: queryError } = useQuery<{ appConfig?: { sportsGlobalConfig?: Defaults } }>(APP_CONFIG)
  const [update] = useMutation(UPDATE_APP_CONFIG)
  const source = data?.appConfig?.sportsGlobalConfig || EMPTY
  useEffect(() => { if (open) void refetch() }, [open, refetch])
  useEffect(() => { if (open) methods.hydrate(defaults(source)) }, [source, methods, open])
  async function save() {
    if (saving) return
    setError(''); setSaving(true)
    try {
      const values = methods.values()
      if (Object.values(values).some(value => typeof value === 'number' && value < 0)) throw new Error('Limits, delays and cooldowns must be zero or greater')
      // A min above its max fails every stake where these defaults apply; the server refuses it too.
      const limitsError = defaultStakeLimitsError(values)
      if (limitsError) throw new Error(limitsError)
      const sportsGlobalConfig = {
        defaultStakeLimits: Object.fromEntries(DOMAINS.flatMap(domain => [[domain + 'Min', values[domain + 'Min']], [domain + 'Max', values[domain + 'Max']]])),
        defaultBetDelays: Object.fromEntries(DOMAINS.map(domain => [domain, values[domain + 'Delay']])),
        defaultBetCooldowns: Object.fromEntries(DOMAINS.map(domain => [domain, values[domain + 'Cooldown']])),
      }
      const result = await update({ variables: { input: { sportsGlobalConfig } }, refetchQueries: [{ query: APP_CONFIG }], awaitRefetchQueries: true })
      if (!result.data?.updateAppConfig?.success) throw new Error(result.data?.updateAppConfig?.message || 'Failed to save default settings')
      notify.success('Default settings saved successfully'); onClose()
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'Failed to save default settings'; setError(message); notify.error(message) }
    finally { setSaving(false) }
  }
  const numeric = (field: string, label: string, money: boolean, step = 1) => <NumberField label={label} value={typeof form.values[field] === 'number' ? form.values[field] as number : null} onChange={value => form.setValue(field, value)} min={0} step={step} prefix={money ? getCurrencySymbol() : undefined} suffix={!money ? 'sec' : undefined} />
  const name = (domain: string) => domain.charAt(0).toUpperCase() + domain.slice(1)
  return <Drawer title="Default Settings" open={open} onOpenChange={next => { if (!next && !saving) onClose() }} dismissible={!saving} size="lg" footer={<><p className={styles.footerHelp}>Adjust default limits and save to apply globally</p><Button disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving} onClick={() => { methods.reset(); methods.hydrate(defaults(source)); setError('') }}>Reset</Button><Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button></>}>
    {loading ? <LoadingState label="Loading configuration..." /> : <fieldset disabled={saving} className={styles.fieldset}><div className={styles.stack}>
      {queryError && <Notice tone="error">{queryError.message}</Notice>}
      <div><h3 className={styles.name}>Default Stake Limits</h3><p className={styles.secondary}>These limits apply where no sport, league, event or VIP override is configured.</p></div>
      {DOMAINS.map(domain => <div key={domain}><h3 className={styles.name}>{name(domain)}</h3><div className={styles.two}>{numeric(domain + 'Min',name(domain) + ' Min Stake',true,1)}{numeric(domain + 'Max',name(domain) + ' Max Stake',true,100)}</div></div>)}
      <div><h3 className={styles.name}>Default Bet Delays</h3><div className={styles.three}>{DOMAINS.map(domain => <div key={domain}>{numeric(domain + 'Delay',name(domain) + ' Delay',false)}</div>)}</div></div>
      <div><h3 className={styles.name}>Default Bet Cooldowns</h3><div className={styles.three}>{DOMAINS.map(domain => <div key={domain}>{numeric(domain + 'Cooldown',name(domain) + ' Cooldown',false)}</div>)}</div></div>
      {error && <Notice tone="error" live="assertive">{error}</Notice>}
    </div></fieldset>}
  </Drawer>
}
