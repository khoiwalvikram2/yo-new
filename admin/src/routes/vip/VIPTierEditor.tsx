import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useVIPTiers, useCreateVIPTier, useUpdateVIPTier } from '@/modules/vip'
import type { VIPTier } from '@/modules/vip/types'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { Form } from '@/ui/components/Form'
import { TextField } from '@/ui/components/TextField'
import { Textarea } from '@/ui/components/Textarea'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { useForm } from '@/ui/form/useForm'
import { VIP_ICON_OPTIONS, vipTierInput, vipTierSchema, vipTierValues, type VIPTierValues } from './vipTierEditorModel'
import styles from './VIPTierEditor.module.css'
import { VipDepositPolicyFields } from '@/modules/vip/components/VipDepositPolicyFields'
import { VipTierAccountsPicker, type ReceivingAccountOption } from '@/modules/vip/components/VipTierAccountsPicker'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

export function VIPTierCreateContent() { return <VIPTierForm /> }
export function VIPTierEditContent() {
  const { id } = useParams()
  const { data, loading } = useVIPTiers()
  if (loading) return <Page><LoadingState label="Loading VIP tier" /></Page>
  const tier = data?.vipTiers.find((item) => item.id === id)
  if (!tier) return <Page><EmptyState title="Tier not found" /></Page>
  return <VIPTierForm key={tier.id} tier={tier} />
}
function VIPTierForm({ tier }: { tier?: VIPTier }) {
  const navigate = useNavigate()
  const eyebrow = usePageEyebrow()
  const [step, setStep] = useState(0)
  const [createTier] = useCreateVIPTier()
  const [updateTier] = useUpdateVIPTier()
  const { getWhitelabelBaseCurrencyCode, getCurrencySymbol, formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const defaultColor = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--vip-tier-default').trim() : ''
  // Receiving accounts are payment-method settings, so choosing them here needs that permission too.
  const permissions = useAuthStore(state => state.permissions)
  const canEditAccounts = hasPermissionWithNested(permissions, 'payments.methods', 'update')
  const [accountIds, setAccountIds] = useState<string[] | null>(null)
  const [accounts, setAccounts] = useState<ReceivingAccountOption[]>([])
  const form = useForm({ schema: vipTierSchema, initialValues: vipTierValues(tier, defaultColor),
    onSubmit: async (values) => {
      const input = { ...vipTierInput(values), ...(canEditAccounts && accountIds ? { receivingAccountIds: accountIds } : {}) }
      const result = tier ? (await updateTier({ variables: { id: tier.id, input } })).data?.updateVIPTier :
        (await createTier({ variables: { input } })).data?.createVIPTier
      if (result?.success) navigate('/vip/tiers')
      else throw new Error(result?.message || 'Unable to save VIP tier')
    },
  })
  async function next() {
    const fields: (keyof VIPTierValues)[] = step === 0 ? ['name', 'level', 'minMonthlyDeposit', 'color', 'depositPolicy'] : step === 1 ? ['benefits'] : ['perks']
    if (await form.validate(fields)) setStep((value) => value + 1)
  }
  return <Page>
    <PageHeader title={tier ? 'Edit VIP Tier' : 'Create VIP Tier'} eyebrow={eyebrow} sub={tier ? 'Update tier details and benefits' : 'Create and configure a VIP tier'}
      back={{ to: '/vip/tiers', label: 'Back to list' }} />
    <div className={styles.workspace}>
      <ol className={styles.steps} aria-label="Tier setup steps">
        {['Basic Details', 'Benefits', 'Perks', 'Review'].map((label, index) =>
          <li key={label} className={styles.step} aria-current={step === index ? 'step' : undefined}>
            <span className={styles.stepNumber}>{index + 1}</span>{label}</li>)}
      </ol>
      <Form onSubmit={(event) => { if (step < 3) { event.preventDefault(); void next() } else form.handleSubmit(event) }}
        errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision}>
        {step === 0 ? <Card title="Basic Details"><div className={styles.fields}>
          <TextField label="Tier Name" {...form.field('name')} placeholder="e.g., Bronze, Silver, Gold" required />
          <NumberField label="Tier Level" {...form.field('level')} min={1} required help="Lower numbers are entry-level tiers." />
          <NumberField label={`Minimum Monthly Deposit (${getWhitelabelBaseCurrencyCode()})`} {...form.field('minMonthlyDeposit')}
            min={0} required grouping="en-IN" prefix={getCurrencySymbol(getWhitelabelBaseCurrencyCode())} />
          <div className={styles.colorField}>
            <label htmlFor="vip-tier-color">Tier Color</label>
            <input id="vip-tier-color" name="color" type="color" value={form.values.color} onChange={(event) => form.setValue('color', event.target.value)}
              aria-invalid={Boolean(form.errors.color)} aria-describedby={form.errors.color ? 'vip-color-error' : undefined} />
            {form.errors.color ? <span className={styles.error} id="vip-color-error" role="alert">{form.errors.color}</span> : null}
          </div>
          {form.values.depositPolicy ? <VipDepositPolicyFields value={form.values.depositPolicy} onChange={value => form.setValue('depositPolicy', value)} errors={form.errors} /> : null}
          {canEditAccounts ? <VipTierAccountsPicker tierId={tier?.id} value={accountIds} onChange={setAccountIds} onAccounts={setAccounts} /> : null}
        </div></Card> : step === 1 ? <Card title="Tier Benefits" sub="Add key benefits that members of this tier will receive.">
          <div className={styles.rows}>{form.values.benefits.map((_, index) => <div key={index} className={styles.benefit}>
            <TextField label={`Benefit ${index + 1}`} {...form.field(`benefits.${index}`)} required />
            <Button onClick={() => form.array('benefits').remove(index)} aria-label={`Remove benefit ${index + 1}`}>Remove</Button>
          </div>)}</div>
          {!form.values.benefits.length ? <EmptyState title="No benefits added yet" /> : null}
          <Button onClick={() => form.array('benefits').append('')}>+ Add Benefit</Button>
        </Card> : step === 2 ? <Card title="Exclusive Perks" sub="Define detailed perks with icons and descriptions for this tier.">
          <div className={styles.rows}>{form.values.perks.map((_, index) => <div key={index} className={styles.perk}>
            <div className={styles.fields}>
              <TextField label={`Perk ${index + 1} Name`} {...form.field(`perks.${index}.name`)} required />
              <Select label={`Perk ${index + 1} Icon`} value={form.values.perks[index].icon || ''} layout="stacked"
                onChange={(value) => form.setValue(`perks.${index}.icon`, value || undefined)} options={[{ value: '', label: 'Select icon' }, ...VIP_ICON_OPTIONS]} />
            </div>
            <Textarea label={`Perk ${index + 1} Description`} {...form.field(`perks.${index}.description`)} rows={2} required />
            <Button onClick={() => form.array('perks').remove(index)} aria-label={`Remove perk ${index + 1}`}>Remove</Button>
          </div>)}</div>
          {!form.values.perks.length ? <EmptyState title="No perks added yet" /> : null}
          <Button onClick={() => form.array('perks').append({ name: '', description: '', icon: undefined })}>+ Add Perk</Button>
        </Card> : <Card title="Review" sub="Confirm details before saving. You can go back to edit anything."><div className={styles.review}>
          <DescriptionList items={[
            { term: 'Tier Name', value: form.values.name }, { term: 'Level', value: form.values.level },
            { term: 'Min Monthly Deposit', value: formatAmount(convertFromWhitelabelCurrency(Number(form.values.minMonthlyDeposit))) },
            { term: 'Color', value: form.values.color },
          ]} />
          <Card title="Deposit rules" headingLevel={3} tools={<Button size="sm" onClick={() => setStep(0)}>Edit Deposit Rules</Button>}>
            <DescriptionList items={[
              { term: 'Deposits', value: form.values.depositPolicy?.enabled ? 'Allowed' : 'Disabled' },
              { term: 'Methods', value: form.values.depositPolicy?.methods.join(', ') || 'None' },
              ...(['min', 'max', 'daily', 'monthly'] as const).map(key => ({ term: ({ min: 'Minimum', max: 'Maximum', daily: 'Daily limit', monthly: 'Monthly limit' })[key],
                value: form.values.depositPolicy?.[key] == null ? 'Use site limits' : formatAmount(convertFromWhitelabelCurrency(form.values.depositPolicy[key]!)) })),
              { term: 'Receiving accounts', value: accountIds == null ? 'Unchanged (set in Payment Methods)'
                : accounts.filter(account => accountIds.includes(account.id)).map(account => account.label).join(', ') || 'None: no bank transfer or UPI' },
            ]} />
          </Card>
          <Card title={`Benefits (${form.values.benefits.length})`} headingLevel={3} tools={<Button size="sm" onClick={() => setStep(1)}>Edit Benefits</Button>}>
            {form.values.benefits.length ? <ul>{form.values.benefits.map((benefit, index) => <li key={index}>{benefit}</li>)}</ul> : <p>No benefits configured</p>}
          </Card>
          <Card title={`Perks (${form.values.perks.length})`} headingLevel={3} tools={<Button size="sm" onClick={() => setStep(2)}>Edit Perks</Button>}>
            {form.values.perks.length ? form.values.perks.map((perk, index) => <div key={index}><strong>{perk.name}</strong><p>{perk.description}</p></div>) : <p>No perks configured</p>}
          </Card>
        </div></Card>}
        {form.formError ? <Notice tone="error">{form.formError}</Notice> : null}
        <div className={styles.footer}><span className={styles.progress}>Step {step + 1} of 4</span><div className={styles.actions}>
          {step === 0 ? <Button onClick={() => navigate('/vip/tiers')}>Cancel</Button> : <Button onClick={() => setStep((value) => value - 1)}>Previous</Button>}
          {step < 3 ? <Button key="next" variant="primary" onClick={(event) => { event.preventDefault(); void next() }}>Next</Button> :
            <Button key="save" type="submit" variant="primary" loading={form.submitting}>{tier ? 'Save Changes' : 'Create Tier'}</Button>}
        </div></div>
      </Form>
    </div>
  </Page>
}
