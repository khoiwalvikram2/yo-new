import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentNode } from 'graphql'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Form } from '@/ui/components/Form'
import { Button } from '@/ui/components/Button'
import { Combobox } from '@/ui/components/Combobox'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Steps } from '@/ui/components/Steps'
import { Switch } from '@/ui/components/Switch'
import { useForm } from '@/ui/form/useForm'
import type { Path } from '@/ui/form/paths'
import BasicInfo from './components/BasicInfo'
import AccountSettings from './components/AccountSettings'
import BettingControls from './components/BettingControls'
import Review from './components/Review'
import { PLAYER_LIMITS, isAgentPlayer, isCreditPlayer, playerCreateSchema, playerCreateValues, type PlayerCreateValues } from './playerCreateModel'
import styles from './PlayerCreateForm.module.css'

const PLAYER_STEPS = [{ title: 'Basic Info' }, { title: 'Account' }, { title: 'Betting' }, { title: 'Review' }] as const

export interface PlayerOwnerOption { value: string; label: string; description?: string }
export function PlayerCreateForm({ creator, phoneQuery, onSave, successMessage, ownerOptions, ownersLoading = false, ownersError }: {
  creator?: { id: string; username: string | null; schemeType: string }; phoneQuery?: DocumentNode
  onSave: (values: PlayerCreateValues) => Promise<void>; successMessage?: string
  /** Agent mode: who will own the player, 'self' first and then the agent's active sub-agents. */
  ownerOptions?: PlayerOwnerOption[]; ownersLoading?: boolean; ownersError?: string
}) {
  const { whitelabel } = useCurrentWhitelabel()
  const { getWhitelabelBaseCurrencyCode, getCurrencySymbol } = useCurrency()
  const baseCurrency = whitelabel?.id ? getWhitelabelBaseCurrencyCode() : 'INR'
  const agentMode = Boolean(creator)
  const [step, setStep] = useState(0)
  const schema = useMemo(() => playerCreateSchema(agentMode), [agentMode])
  const form = useForm({ schema, initialValues: playerCreateValues(whitelabel?.id, creator?.schemeType, baseCurrency), onSubmit: onSave })
  const formRef = useRef(form); formRef.current = form
  const getValue = useCallback(<P extends Path<PlayerCreateValues>,>(name: P) => formRef.current.getValue(name), [])
  const panelForm = { ...form, getValue }
  const { setValue } = form
  useEffect(() => {
    if ((creator?.schemeType === 'CREDIT' || creator?.schemeType === 'SHARING') && getValue('currency') !== baseCurrency) setValue('currency', baseCurrency)
  }, [creator?.schemeType, baseCurrency, getValue, setValue])
  const eyebrow = usePageEyebrow()
  async function next() {
    const fields: Path<PlayerCreateValues>[] = step === 0 ? ['name', 'email', 'phone', 'dialCode', 'password', ...(isAgentPlayer(form.values.playerType) ? ['agentId' as const] : []),
      ...(isCreditPlayer(form.values.playerType) ? ['creditLimit' as const] : [])] : ['currency', 'status']
    if (step === 2 || await form.validate(fields)) setStep((value) => Math.min(3, value + 1))
  }
  return <Page maxWidth="wide"><PageHeader title={agentMode ? 'Create New Player' : 'Create Player'} eyebrow={eyebrow}
    sub={agentMode ? 'Create a player account under your agency' : 'Set up a new player account with comprehensive details'} back={{ to: '/players', label: 'Back to Players' }} />
    <div className={styles.workspace}>
      {successMessage && <Notice tone="ok">{successMessage}</Notice>}
      {!agentMode && <Steps label="Player setup steps" steps={PLAYER_STEPS} current={step} />}
      <Form onSubmit={(event) => { if (!agentMode && step < 3) { event.preventDefault(); void next() } else form.handleSubmit(event) }}
        errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision}>
        <fieldset className={styles.fieldset} disabled={form.submitting}>
          {agentMode ? <div className={styles.stack}>
            {ownerOptions ? <Card title="Create Player For"><div className={styles.stack}>
              <Combobox label="Player owner" value={form.values.targetAgentId || 'self'} onChange={(value) => setValue('targetAgentId', value || 'self')}
                options={ownerOptions} loading={ownersLoading} required help={`Yourself or one of your active sub-agents. Player type: ${form.values.playerType}.`} />
              {creator?.schemeType === 'CREDIT' && form.values.targetAgentId !== 'self' && <Notice tone="info">The player starts with no credit. The sub-agent assigns its credit limit.</Notice>}
            </div></Card> :
              <Notice tone="info" title="Create Player For">Direct — Myself ({creator?.username || 'Agent'}). Player type: {form.values.playerType}.</Notice>}
            {ownersError && <Notice tone="warn" title="Sub-agents unavailable">{ownersError}. The player can still be created for yourself.</Notice>}
            <BasicInfo form={panelForm} tenant={whitelabel?.id} agentMode phoneQuery={phoneQuery} />
            <Card title="Financial Settings"><div className={styles.stack}>
              <p className={styles.secondary}>Currency: {form.values.currency}. Initial balance and credit allocation start at zero and are managed through the credit system.</p>
              {creator?.schemeType === 'CREDIT' ? <Notice tone="info">Credit players are not eligible for bonuses. This is automatically enforced.</Notice> :
                <Switch label="Enable Bonus Eligibility" {...form.field('bonusAllowed')} checked={form.values.bonusAllowed} />}
            </div></Card>
            <Card title="Betting Limits" sub="Player limits cannot exceed your agent limits"><div className={styles.fields}>
              {PLAYER_LIMITS.filter(({ key }) => key !== 'weeklyStakeLimit').map(({ key, label }) => <NumberField key={key} label={label} {...form.field(key)} value={form.values[key] ?? null} min={0} precision={2} prefix={getCurrencySymbol(form.values.currency)} />)}
            </div></Card>
          </div> : step === 0 ? <BasicInfo form={panelForm} tenant={whitelabel?.id} /> : step === 1 ? <AccountSettings form={panelForm} tenant={whitelabel?.id} /> : step === 2 ? <BettingControls form={panelForm} /> : <Review form={panelForm} />}
        </fieldset>
        {form.formError && <Notice tone="error">{form.formError}</Notice>}
        <div className={styles.footer}>
          {!agentMode && <span className={styles.secondary}>Step {step + 1} of 4</span>}
          <div className={styles.actions}>
            {!agentMode && step > 0 && <Button aria-disabled={form.submitting} onClick={() => setStep((value) => value - 1)}>Previous</Button>}
            {!agentMode && step < 3 ? <Button key="next" variant="primary" onClick={(event) => { event.preventDefault(); void next() }}>Next Step</Button> :
              <Button key="save" variant="primary" type="submit" loading={form.submitting}>Create Player</Button>}
          </div>
        </div>
      </Form>
    </div>
  </Page>
}
