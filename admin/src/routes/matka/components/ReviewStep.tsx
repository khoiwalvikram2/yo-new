import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import { DAY_OPTIONS, type MatkaFormValues } from '../matkaFormModel'
import styles from '../CreateEditPage.module.css'

interface ReviewStepProps {
  values: MatkaFormValues
}

export default function ReviewStep({ values }: ReviewStepProps) {
  const { formatAmount } = useCurrency()
  const days = values.schedule.daysOfWeek
  const amount = (value: number | null | undefined) => (
    value === null || value === undefined ? 'Not set' : formatAmount(value)
  )

  const basicItems: DescriptionListItem[] = [
    { key: 'kind', term: 'Market Type', value: values.settings.matkaType || 'worli' },
    { key: 'timezone', term: 'Timezone', value: values.timezone },
    { key: 'overnight', term: 'Closes Next Day', value: values.schedule.closesNextDay ? 'Yes' : 'No' },
    { key: 'name', term: 'Name', value: values.name || '-' },
    { key: 'code', term: 'Code', value: values.code || '-' },
    { key: 'open', term: 'Open Time', value: values.schedule.openTime || '-' },
    { key: 'close', term: 'Close Time', value: values.schedule.closeTime || '-' },
    {
      key: 'days',
      term: 'Operating Days',
      value: days.length ? (
        <span className={styles.reviewTags}>
          {days.map((day) => (
            <StatusPill key={day} tone="info">
              {DAY_OPTIONS.find((option) => option.value === day)?.full}
            </StatusPill>
          ))}
        </span>
      ) : 'None',
    },
    { key: 'priority', term: 'Priority', value: String(values.priority ?? 0) },
  ]

  const bettingItems: DescriptionListItem[] = [
    { key: 'min', term: 'Min Bet Amount', value: amount(values.limits.minBet) },
    { key: 'max', term: 'Max Bet Amount', value: amount(values.limits.maxBet) },
    {
      key: 'status',
      term: 'Status',
      value: <StatusPill status={values.status || 'ACTIVE'}>{values.status || 'ACTIVE'}</StatusPill>,
    },
    {
      key: 'featured',
      term: 'Featured',
      value: (
        <StatusPill tone={values.visibility.featured ? 'info' : 'neutral'}>
          {values.visibility.featured ? 'Yes' : 'No'}
        </StatusPill>
      ),
    },
  ]

  const operationalItems: DescriptionListItem[] = [
    {
      key: 'threshold',
      term: 'Auto-pause Liability Threshold',
      value: values.settings.autoPauseOnLiabilityThreshold
        ? amount(values.settings.autoPauseOnLiabilityThreshold)
        : 'Not set',
    },
    {
      key: 'before-open',
      term: 'Betting Cutoff (Before Open)',
      value: `${values.settings.betWindowMinsBeforeOpen || 0} min`,
    },
    {
      key: 'before-close',
      term: 'Betting Cutoff (Before Close)',
      value: `${values.settings.betWindowMinsBeforeClose || 0} min`,
    },
    ...(values.settings.notes
      ? [{ key: 'notes', term: 'Internal Notes', value: values.settings.notes }]
      : []),
  ]

  return (
    <Card title="Review Matka Information" className={styles.stepCard}>
      <div className={styles.reviewGrid}>
        <DescriptionList.Section className={styles.reviewSection} title="Basic Information">
          <DescriptionList items={basicItems} />
        </DescriptionList.Section>
        <DescriptionList.Section className={styles.reviewSection} title="Betting Limits & Status">
          <DescriptionList items={bettingItems} />
        </DescriptionList.Section>
        <DescriptionList.Section className={styles.reviewSection} title="Operational Settings">
          <DescriptionList items={operationalItems} />
        </DescriptionList.Section>
      </div>
    </Card>
  )
}
