import { IconBulb, IconCircleCheck } from '@tabler/icons-react'
import { Card } from '@/ui/components/Card'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { ImagePreview } from '@/ui/components/ImagePreview'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  isSafeImageSource,
  rateReviews,
  statusReview,
  type WhitelabelWizardValues,
} from '../whitelabelWizardModel'
import styles from '../WhitelabelWizardPage.module.css'

interface WhitelabelEditReviewProps {
  values: WhitelabelWizardValues
}

function assetValue(source: string | null, alt: string) {
  if (!source) return <span className={styles.muted}>Not uploaded</span>
  return (
    <span className={styles.assetReview}>
      {isSafeImageSource(source) ? (
        <ImagePreview
          className={alt === 'Logo preview' ? styles.reviewLogo : styles.reviewFavicon}
          src={source}
          alt={alt}
          fit="contain"
          dialogTitle={alt}
        />
      ) : null}
      <StatusPill status="ready">✓ Ready to save</StatusPill>
    </span>
  )
}

export default function WhitelabelEditReview({ values }: WhitelabelEditReviewProps) {
  const status = statusReview(values.status)
  const rates = rateReviews(values)
  const sharePercent = values.sharePercent ?? 0

  const basic: DescriptionListItem[] = [
    { term: 'Whitelabel Name', value: <strong>{values.name || 'Not specified'}</strong> },
    { term: 'Primary Domain', value: <code className={styles.code}>{values.domain || 'Not specified'}</code> },
  ]
  const branding: DescriptionListItem[] = [
    { term: 'Logo', value: assetValue(values.logoUrl, 'Logo preview') },
    { term: 'Favicon', value: assetValue(values.faviconUrl, 'Favicon preview') },
  ]
  const sharing: DescriptionListItem[] = rates.length
    ? rates.map((rate) => ({
        key: rate.domain,
        term: rate.label,
        value: (
          <span className={styles.rateReview}>
            <strong>{rate.value}</strong>
            <StatusPill tone={rate.tone}>{rate.status}</StatusPill>
          </span>
        ),
      }))
    : [
        {
          term: 'GGR Share Percentage',
          value: (
            <span className={styles.rateReview}>
              <strong>{sharePercent}%</strong>
              <StatusPill tone={sharePercent > 25 ? 'neg' : sharePercent < 5 ? 'ok' : 'info'}>
                {sharePercent > 25 ? 'High Share' : sharePercent < 5 ? 'Low Share' : 'Standard Share'}
              </StatusPill>
            </span>
          ),
        },
        { term: 'Platform Retains', value: <strong>{100 - sharePercent}% of GGR</strong> },
      ]
  const account: DescriptionListItem[] = [
    {
      term: 'Account Status',
      value: (
        <span className={styles.statusReview}>
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          <span className={styles.muted}>{status.description}</span>
        </span>
      ),
    },
    { term: 'Admin Name', value: <strong>{values.adminName || 'Not specified'}</strong> },
    { term: 'Admin Email', value: <code className={styles.code}>{values.adminEmail || 'Not specified'}</code> },
    { term: 'Contact Phone', value: <code className={styles.code}>{values.adminPhone || 'Not specified'}</code> },
  ]

  return (
    <div className={styles.stepStack}>
      <Notice
        tone="ok"
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        title="Review Whitelabel Changes"
      >
        Please review all the changes below before updating the whitelabel. The changes will be applied immediately.
      </Notice>

      <div className={styles.reviewGrid}>
        <Card title="Basic Information" headingLevel={3}>
          <DescriptionList items={basic} />
        </Card>
        <Card title="Branding Assets" headingLevel={3}>
          <DescriptionList items={branding} />
        </Card>
        <Card title="Revenue Share Configuration" headingLevel={3}>
          <DescriptionList items={sharing} />
        </Card>
        <Card title="Account Information" headingLevel={3}>
          <DescriptionList items={account} />
        </Card>
      </div>

      <Card title="What happens next?" headingLevel={3}>
        <ol className={styles.nextSteps}>
          <li>Whitelabel configuration will be updated with the new settings</li>
          <li>Branding assets (logo/favicon) will be updated if provided</li>
          <li>Revenue sharing percentage will be applied to all transactions</li>
          <li>Changes will be visible immediately in the partner&apos;s dashboard</li>
        </ol>
        <Notice
          className={styles.themeNote}
          tone="info"
          icon={<IconBulb size={18} stroke={strokeFor(18)} />}
        >
          <strong>Note:</strong> Theme colors are now configured separately in the App Configuration page
        </Notice>
      </Card>
    </div>
  )
}
