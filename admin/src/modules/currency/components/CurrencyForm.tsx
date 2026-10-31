import type { Ref } from 'react'
import type { Currency, CreateCurrencyInput, UpdateCurrencyInput } from '@/shared/types/currency'
import {
  EXCHANGE_RATE_PRECISION,
  MAX_DECIMALS,
  MIN_DECIMALS,
  MIN_EXCHANGE_RATE,
  buildCurrencyInput,
  currencyFormSchema,
  currencyFormValues,
  normaliseCurrencyCode,
  type CurrencyFormValues,
} from '@/routes/currency/currencyManagementModel'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Form } from '@/ui/components/Form'
import { NumberField } from '@/ui/components/NumberField'
import { Switch } from '@/ui/components/Switch'
import { TextField } from '@/ui/components/TextField'
import { useForm, type FormApi } from '@/ui/form/useForm'
import styles from './CurrencyForm.module.css'

interface CurrencyFormProps {
  currency?: Currency
  /** Awaited, so the submit stays busy and a second Enter is ignored until the save settles. */
  onSubmit: (values: CreateCurrencyInput | UpdateCurrencyInput) => void | Promise<void>
  onCancel: () => void
  loading?: boolean
  inModal?: boolean
  /** Receives the first editable field (the code on create, the name on edit), for a dialog's first focus. */
  firstFieldRef?: Ref<HTMLInputElement>
}

/**
 * The create / edit currency form on the kit form engine. Mount it with its record: useForm reads its
 * initial values on its first render only. Labels, placeholders, the legacy tooltips (as help text), the
 * rules and their messages, and the submitted fields are the legacy antd form's.
 */
export function CurrencyForm({
  currency,
  onSubmit,
  onCancel,
  loading = false,
  inModal = false,
  firstFieldRef,
}: CurrencyFormProps) {
  const isEditing = !!currency

  const form: FormApi<CurrencyFormValues> = useForm<CurrencyFormValues>({
    schema: currencyFormSchema,
    initialValues: currencyFormValues(currency),
    onSubmit: (values) => onSubmit(buildCurrencyInput(values, currency)),
  })

  const code = form.field('code')
  const name = form.field('name')
  const symbol = form.field('symbol')
  const decimals = form.field('decimals')
  const exchangeRate = form.field('exchangeRate')

  const formContent = (
    <Form
      className={styles.form}
      onSubmit={form.handleSubmit}
      errorAnnouncement={form.errorAnnouncement}
      errorAnnouncementRevision={form.errorAnnouncementRevision}
    >
      {/* The code is upper-cased as it is typed (the legacy normalize) and cannot change once created. */}
      <TextField
        {...code}
        ref={isEditing ? undefined : firstFieldRef}
        onChange={(value) => code.onChange(normaliseCurrencyCode(value))}
        label="Currency Code"
        help="Three-letter ISO code, e.g., USD, EUR, INR"
        placeholder="e.g., USD, EUR, INR"
        disabled={isEditing}
        required
        autoComplete="off"
        spellCheck={false}
        inputClassName={styles.codeInput}
      />

      <TextField
        {...name}
        ref={isEditing ? firstFieldRef : undefined}
        label="Currency Name"
        help="Human-friendly name, e.g., US Dollar, Euro"
        placeholder="e.g., US Dollar, Euro, Indian Rupee"
        required
      />

      <TextField
        {...symbol}
        label="Currency Symbol"
        help="Symbol used for display, e.g., $, €, ₹"
        placeholder="e.g., $, €, ₹"
        required
      />

      <NumberField
        {...decimals}
        label="Decimal Places"
        help="Number of fraction digits to display (0–8)"
        placeholder="2"
        min={MIN_DECIMALS}
        max={MAX_DECIMALS}
        required
      />

      <NumberField
        {...exchangeRate}
        label="Exchange Rate (vs USD)"
        help="Relative to USD. Used for conversions."
        placeholder="e.g., 83.0 for INR"
        min={MIN_EXCHANGE_RATE}
        step={MIN_EXCHANGE_RATE}
        precision={EXCHANGE_RATE_PRECISION}
      />

      {isEditing ? (
        <Switch
          label="Active Status"
          checked={form.values.isActive}
          onChange={(checked) => form.setValue('isActive', checked)}
        />
      ) : null}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={loading || form.submitting}>
          {isEditing ? 'Update Currency' : 'Create Currency'}
        </Button>
        <Button onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Form>
  )

  if (inModal) {
    return formContent
  }

  return (
    <Card title={isEditing ? 'Edit Currency' : 'Create New Currency'}>
      {formContent}
    </Card>
  )
}
