import type { VIPDepositPolicy } from '../types'
import { Switch } from '@/ui/components/Switch'
import { Checkbox } from '@/ui/components/Checkbox'
import { NumberField } from '@/ui/components/NumberField'

export function VipDepositPolicyFields({ value, onChange, errors = {} }: {
  value: VIPDepositPolicy
  onChange: (value: VIPDepositPolicy) => void
  errors?: Record<string, string | undefined>
}) {
  return <section style={{ gridColumn: '1 / -1', display: 'grid', gap: 16 }} aria-label="Tier deposit rules">
    <h3>Deposit rules</h3>
    <Switch label="Allow deposits for this tier" checked={value.enabled} onChange={enabled => onChange({ ...value, enabled })} />
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 5, padding: 14, display: 'grid', gap: 12 }}>
      <legend>Allowed payment methods</legend>
      {([['BANK_TRANSFER', 'Bank transfer'], ['UPI', 'UPI'], ['GATEWAY', 'Online payment gateway']] as const).map(([method, label]) =>
        <Checkbox key={method} label={label} checked={value.methods.includes(method)} onChange={checked =>
          onChange({ ...value, methods: checked ? [...value.methods, method] : value.methods.filter(item => item !== method) })} />)}
      {errors['depositPolicy.methods'] ? <p role="alert">{errors['depositPolicy.methods']}</p> : null}
    </fieldset>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 16 }}>
      {([['min', 'Minimum per deposit'], ['max', 'Maximum per deposit'], ['daily', 'Daily deposit limit'], ['monthly', 'Monthly deposit limit']] as const).map(([key, label]) =>
        <NumberField key={key} label={label} value={value[key]} min={0} step={1} placeholder="Use site limits"
          error={errors[`depositPolicy.${key}`]} onChange={amount => onChange({ ...value, [key]: amount })}
          help={key === 'daily' || key === 'monthly' ? 'Leave empty for no extra tier limit. Pending deposits count towards this limit.' : 'Leave empty to use site and receiving-account limits.'} />)}
    </div>
    <p>Amounts use the site base currency. Receiving accounts can be chosen below or in Payment Methods. Saved changes apply to new deposit requests.</p>
  </section>
}
