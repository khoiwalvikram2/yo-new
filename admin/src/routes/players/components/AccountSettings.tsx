import { useEffect } from 'react'
import { useQuery, gql } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { Card } from '@/ui/components/Card'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { Switch } from '@/ui/components/Switch'
import { TextField } from '@/ui/components/TextField'
import { Notice } from '@/ui/components/Notice'
import type { FormApi } from '@/ui/form/useForm'
import { isCreditPlayer, type PlayerCreateValues } from '../playerCreateModel'
import styles from '../PlayerCreateForm.module.css'

export default function AccountSettings({ form, tenant }: { form: FormApi<PlayerCreateValues>; tenant?: string | null }) {
  const { getWhitelabelBaseCurrencyCode } = useCurrency()
  const agent = useAuthStore((state) => state.agent)
  const roles = useAuthStore((state) => state.roles)
  // Picking a tier here pins it, which the server allows only with VIP update rights.
  const permissions = useAuthStore((state) => state.permissions)
  const canSetVip = hasPermissionWithNested(permissions, 'players.vip', 'update')
  const { data, loading, error } = useQuery<{ vipTiers: { id: string; name: string; status: string }[] }>(gql`{ vipTiers { id name status } }`, { skip: Boolean(agent) || !canSetVip })
  const vipOptions = (data?.vipTiers || []).filter((tier) => tier.status === 'active')
  const credit = isCreditPlayer(form.values.playerType)
  const showVip = !credit && !agent && canSetVip
  const readonly = credit || Boolean(agent) || Boolean(tenant) || roles.some((role) => role === 'Whitelabel Admin' || role.toLowerCase().includes('whitelabel'))
  const baseCurrency = tenant ? getWhitelabelBaseCurrencyCode() : 'INR'
  const { setValue, getValue } = form
  useEffect(() => {
    if (readonly && getValue('currency') !== baseCurrency) setValue('currency', baseCurrency)
    if (credit && getValue('bonusAllowed')) setValue('bonusAllowed', false)
    if (credit && getValue('vipTier')) { setValue('vipTier', ''); setValue('vipTierName', '') }
  }, [readonly, credit, baseCurrency, setValue, getValue])
  return <Card title="Account Settings"><div className={styles.fields}>
    <Select label="Risk Type" {...form.field('riskType')} layout="stacked" options={[{ value: '', label: 'Default' }, { value: 'LOW', label: 'Low' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'HIGH', label: 'High' }]} />
    {readonly ? <TextField label="Currency" value={form.values.currency} onChange={() => undefined} disabled help="Set to the whitelabel base currency." /> :
      <Select label="Currency" {...form.field('currency')} required layout="stacked" options={['USD', 'EUR', 'INR', 'GBP'].map((value) => ({ value, label: value }))} />}
    <Select label="Account Status" {...form.field('status')} required layout="stacked" options={[
      { value: 'active', label: 'Active - Can login & play' }, { value: 'inactive', label: 'Inactive - Limited access' }, { value: 'suspended', label: 'Suspended - No access' },
    ]} />
    {showVip ? <Combobox label="VIP Tier" {...form.field('vipTier')} value={form.values.vipTier || null} loading={loading} clearable
      onChange={(value) => { setValue('vipTier', value || ''); setValue('vipTierName', vipOptions.find((tier) => tier.id === value)?.name || '') }}
      options={vipOptions.map((tier) => ({ value: tier.id, label: tier.name }))} /> : null}
    {showVip && error && <Notice tone="error" title="VIP tiers unavailable">{error.message}</Notice>}
    <Switch label="Enable Bonus Eligibility" checked={form.values.bonusAllowed} disabled={form.values.status !== 'active' || credit} onChange={(value) => setValue('bonusAllowed', value)} />
  </div></Card>
}

