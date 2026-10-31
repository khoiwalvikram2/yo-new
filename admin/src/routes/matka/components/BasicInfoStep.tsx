import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { useEffect, useState } from 'react'
import { Card } from '@/ui/components/Card'
import { FormField, FormSection } from '@/ui/components/Form'
import { NumberField } from '@/ui/components/NumberField'
import { TextField } from '@/ui/components/TextField'
import { TimeField } from '@/ui/components/TimeField'
import type { FormApi } from '@/ui/form/useForm'
import {
  DAY_OPTIONS,
  QUICK_DAYS,
  sameDays,
  selectedDaysSummary,
  slugFromMatkaName,
  toggleDay,
  type MatkaFormValues,
} from '../matkaFormModel'
import styles from '../CreateEditPage.module.css'

interface BasicInfoStepProps {
  form: FormApi<MatkaFormValues>
  isEdit?: boolean
}

export default function BasicInfoStep({ form, isEdit = false }: BasicInfoStepProps) {
  const [userModifiedCode, setUserModifiedCode] = useState(false)
  const name = form.field('name')
  const code = form.field('code')
  const priority = form.field('priority')
  const openTime = form.field('schedule.openTime')
  const closeTime = form.field('schedule.closeTime')
  const selected = form.values.schedule.daysOfWeek

  // Create mode keeps the legacy live slug until the operator intentionally changes the code.
  useEffect(() => {
    if (isEdit || !name.value || userModifiedCode) return
    const generated = slugFromMatkaName(name.value)
    if (generated !== code.value) form.setValue('code', generated)
  }, [code.value, form, isEdit, name.value, userModifiedCode])

  const setSelected = (next: number[]) => form.setValue('schedule.daysOfWeek', next)

  return (
    <Card title="Basic Matka Information" className={styles.stepCard}>
      <div className={styles.basicGrid}>
        <div className={styles.basicDetails}>
          <FormSection
            title="Details"
            description="Give the Matka a clear name and a unique code (kebab-case)."
          >
            <Select {...form.field('settings.matkaType')} value={form.values.settings.matkaType || 'worli'} onChange={value => form.setValue('settings.matkaType', value as NonNullable<MatkaFormValues['settings']['matkaType']>)} label="Market Type" layout="stacked" options={[{value:'worli',label:'Worli'},{value:'starline',label:'Starline'},{value:'jackpot',label:'Jackpot'},{value:'sattaMatka',label:'Satta Matka'}]} required />
            <TextField {...form.field('timezone')} label="Timezone" placeholder="Asia/Kolkata" required />
            <TextField
              {...name}
              label="Name"
              placeholder="e.g., Kalyan Morning"
              clearable
              required
            />
            {!isEdit ? (
              <TextField
                {...code}
                label="Code"
                placeholder="kalyan-morning"
                clearable
                required
                onChange={(value) => {
                  const generated = slugFromMatkaName(form.getValue('name') || '')
                  // The clear control resumes generation, matching the old allowClear path.
                  setUserModifiedCode(value === '' ? false : value !== generated)
                  code.onChange(value)
                }}
              />
            ) : (
              <NumberField
                {...priority}
                label="Priority"
                min={0}
                step={1}
                help="Controls ordering in lists"
              />
            )}
          </FormSection>

          <FormSection
            title="Schedule Times"
            description="Set open/close in local tenant time."
          >
            <TimeField {...openTime} label="Open Time" step={300} help="Local time" required />
            <TimeField {...closeTime} label="Close Time" step={300} help="Local time" required />
            <Switch checked={!!form.values.schedule.closesNextDay} onChange={value => form.setValue('schedule.closesNextDay', value)} label="Worli closes next day" />
          </FormSection>
        </div>

        <FormField
          className={styles.daysField}
          label="Operating Days"
          required
          error={form.errors['schedule.daysOfWeek']}
        >
          <div className={styles.daysPanel}>
            <div className={styles.quickDays}>
              <span className={styles.quickLabel}>Quick select:</span>
              {QUICK_DAYS.map((option) => {
                const active = sameDays(selected, option.values)
                return (
                  <button
                    key={option.label}
                    type="button"
                    name="schedule.daysOfWeek"
                    className={styles.quickButton}
                    aria-pressed={active}
                    onClick={() => setSelected([...option.values])}
                  >
                    {option.label}
                  </button>
                )
              })}
              <button
                type="button"
                name="schedule.daysOfWeek"
                className={styles.clearDays}
                onClick={() => setSelected([])}
              >
                Clear
              </button>
            </div>

            <div className={styles.dayGrid}>
              {DAY_OPTIONS.map((day) => {
                const active = selected.includes(day.value)
                return (
                  <button
                    key={day.value}
                    type="button"
                    name="schedule.daysOfWeek"
                    className={styles.dayButton}
                    aria-label={day.full}
                    aria-pressed={active}
                    onClick={() => setSelected(toggleDay(selected, day.value))}
                  >
                    <span className={styles.dayShort} aria-hidden="true">{day.short}</span>
                    <span className={styles.dayLabel}>{day.label}</span>
                  </button>
                )
              })}
            </div>

            <p className={styles.daySummary} aria-live="polite">
              {selectedDaysSummary(selected)}
            </p>
          </div>
        </FormField>
      </div>
    </Card>
  )
}
