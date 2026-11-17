import { TextField } from '@/ui/components/TextField'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { FormField, FormSection } from '@/ui/components/Form'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { Textarea } from '@/ui/components/Textarea'
import type { FormApi } from '@/ui/form/useForm'
import type { MatkaFormValues } from '../matkaFormModel'
import styles from '../CreateEditPage.module.css'

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPEND', label: 'Suspend' },
] as const

export default function BettingConfigurationStep({ form }: { form: FormApi<MatkaFormValues> }) {
  const { getCurrencySymbol } = useCurrency()
  const minBet = form.field('limits.minBet')
  const maxBet = form.field('limits.maxBet')
  const status = form.field('status')
  const threshold = form.field('settings.autoPauseOnLiabilityThreshold')
  const beforeOpen = form.field('settings.betWindowMinsBeforeOpen')
  const beforeClose = form.field('settings.betWindowMinsBeforeClose')
  const notes = form.field('settings.notes')
  const currency = getCurrencySymbol()

  return (
    <Card title="Betting Configuration" className={styles.stepCard}>
      <div className={styles.configurationGrid}>
        <div className={styles.configurationColumn}>
          <FormSection title="Betting Limits" className={styles.configSection}>
            {/* The server needs a positive minimum, so the hint says so: min={0} printed "Minimum: 0." beside the
                field's own "Value must be more than 0", and Next checks the rule before Review. */}
            <NumberField {...minBet} label="Min Bet Amount" prefix={currency} placeholder="10" help="Must be more than 0." required />
            <NumberField {...maxBet} label="Max Bet Amount" min={0} prefix={currency} placeholder="10000" required />
          </FormSection>

          <FormSection title="Status & Visibility" className={styles.configSection}>
            <Select
              {...status}
              label="Status"
              options={STATUS_OPTIONS}
              placeholder="Select status"
              layout="stacked"
              help="Inactive prevents placing bets"
              required
            />
            <FormField label="Featured" help="Show in featured section">
              <span className={styles.switchRow}>
                <Switch
                  checked={form.values.visibility.featured}
                  onChange={(checked) => form.setValue('visibility.featured', checked)}
                  label="Featured"
                  hideLabel
                />
                <span>{form.values.visibility.featured ? 'Yes' : 'No'}</span>
              </span>
            </FormField>
          </FormSection>
        </div>

        <FormSection
          title="Operational Settings"
          className={styles.configSection}
          gridClassName={styles.operationalGrid}
        >
          <NumberField
            {...threshold}
            className={styles.fullRow}
            label="Auto-pause Liability Threshold"
            min={0}
            prefix={currency}
            placeholder="Optional"
            help="Auto-pause when total liability exceeds this amount"
          />
          <NumberField
            {...beforeOpen}
            label="Betting Cutoff (Before Open)"
            min={0}
            suffix="min"
            placeholder="15"
            help="Minutes before open time"
            required
          />
          <NumberField
            {...beforeClose}
            label="Betting Cutoff (Before Close)"
            min={0}
            suffix="min"
            placeholder="10"
            help="Minutes before close time"
            required
          />
          <Switch checked={!!form.values.settings.openSuspended} onChange={value => form.setValue('settings.openSuspended', value)} label="Suspend Open betting" />
          <Switch checked={!!form.values.settings.closeSuspended} onChange={value => form.setValue('settings.closeSuspended', value)} label="Suspend Close betting" />
          <TextField {...form.field('settings.message')} value={form.values.settings.message || ''} label="Player notice" help="Shown on this market in the player panel" />
          <Textarea
            {...notes}
            className={styles.fullRow}
            label="Internal Notes"
            rows={3}
            placeholder="Add any internal notes or comments..."
          />
        </FormSection>
      </div>
    </Card>
  )
}
