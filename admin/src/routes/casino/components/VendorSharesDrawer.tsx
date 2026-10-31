import React from 'react'
import { useMutation, useQuery } from '@apollo/client'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBuildingStore,
  IconCheck,
  IconInbox,
  IconInfoCircle,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { PROVIDER_VENDOR_SHARES, UPSERT_PROVIDER_VENDOR_SHARE, PROVIDER_ANALYTICS } from '@/lib/graphql/casino'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { startOfDay, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import type { ProviderWithVendors, CasinoProviderVendorShare } from '@/modules/casino/types'
import { Button } from '@/ui/components/Button'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Meter } from '@/ui/components/Meter'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Spinner } from '@/ui/components/Spinner'
import { toast } from '@/ui/components/toast'
import {
  SHARES_FAILED,
  SHARES_FAILED_MS,
  SHARES_SAVED,
  SHARES_SAVED_MS,
  SHARES_SAVING,
  configuredCount,
  hasShareChanges,
  projectedShare,
  shareDraft,
  shareFromField,
  shareMeterTone,
  shareUpsertVariables,
  totalShare,
  totalShareTone,
  type VendorBreakdownEntry,
} from '../providersPageModel'
import styles from '../ProvidersPage.module.css'

type Props = {
  open: boolean
  onClose: () => void
  provider?: ProviderWithVendors | null
  onSaved?: () => void
}

const TOTAL_TONE_CLASS = {
  pos: styles.tonePos,
  warn: styles.toneWarn,
  neg: styles.toneNeg,
} as const

/* One vendor's share: the percentage field, the legacy bar under it, and today's figures with the projected
   share (BEYOND-MOCKUP: the mockup draws no shares editor; the tile follows the drawer section idiom). */
const VendorShareRow: React.FC<{
  vendor: { id: string; name: string; slug: string }
  providerId: string
  value: number
  onChange: (val: number) => void
  analytics?: { ggr: number; transactionCount: number }
}> = ({ vendor, value, onChange, analytics }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const ggr = analytics?.ggr ?? 0
  const transactionCount = analytics?.transactionCount ?? 0
  const formattedGgr = formatAmount(convertFromWhitelabelCurrency(Number(ggr)))
  const formattedProjected = formatAmount(convertFromWhitelabelCurrency(Number(projectedShare(ggr, value))))

  return (
    <li className={styles.listItem}>
      <div className={styles.itemHead}>
        <span className={clsx(styles.tile, styles.tileVendor)} aria-hidden="true">
          <IconBuildingStore size={15} stroke={strokeFor(15)} />
        </span>
        <div className={styles.entityBody}>
          <span className={styles.entityName}>{vendor.name}</span>
          <span className={styles.entitySub}>{vendor.slug}</span>
        </div>
      </div>

      {/* The visible label is the legacy caption; the name also says which vendor it sets. */}
      <NumberField
        label="Share Percentage"
        aria-label={`Share Percentage for ${vendor.name}`}
        help="Commission rate for this vendor"
        size="sm"
        min={0}
        max={100}
        step={0.1}
        suffix="%"
        value={value}
        onChange={(val) => onChange(shareFromField(val))}
        className={styles.shareField}
      />

      {value > 0 && <Meter value={value} tone={shareMeterTone(value)} className={styles.meter} />}

      <dl className={styles.pairs}>
        <div className={styles.pair}>
          <dt className={styles.pairTerm}>Today's GGR</dt>
          <dd className={styles.pairValue}>{formattedGgr}</dd>
        </div>
        <div className={styles.pair}>
          <dt className={styles.pairTerm}>Your Share</dt>
          <dd className={clsx(styles.pairValue, styles.pairAccent)}>{formattedProjected}</dd>
        </div>
        <div className={styles.pair}>
          <dt className={styles.pairTerm}>Txns</dt>
          <dd className={styles.pairValue}>{transactionCount}</dd>
        </div>
      </dl>
    </li>
  )
}

export const VendorSharesDrawer: React.FC<Props> = ({ open, onClose, provider, onSaved }) => {
  const summaryId = React.useId()
  const configurationId = React.useId()
  const providerId = provider?.id
  const today = React.useMemo(() => new Date(), [])
  const start = startOfDay(today, DEFAULT_ADMIN_TZ).toISOString()
  const end = today.toISOString()

  // Load shares and analytics in parallel (single query for all vendor analytics)
  const { data: sharesData, loading: sharesLoading, refetch } = useQuery(PROVIDER_VENDOR_SHARES, {
    variables: providerId ? { providerId } : undefined,
    skip: !providerId,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const { data: analyticsData, loading: analyticsLoading } = useQuery(PROVIDER_ANALYTICS, {
    variables: providerId ? { providerId, start, end } : undefined,
    skip: !providerId,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const [upsertShare, { loading: saving }] = useMutation(UPSERT_PROVIDER_VENDOR_SHARE)
  const shares: CasinoProviderVendorShare[] = React.useMemo(() => sharesData?.providerVendorShares ?? [], [sharesData])
  const vendorBreakdown: VendorBreakdownEntry[] = React.useMemo(
    () => analyticsData?.providerAnalytics?.vendorBreakdown ?? [],
    [analyticsData],
  )

  // Create analytics map for quick lookup
  const analyticsMap = React.useMemo(() => {
    const map = new Map<string, { ggr: number; transactionCount: number }>()
    vendorBreakdown.forEach((v) => {
      map.set(v.vendorId, {
        ggr: v.ggr ?? 0,
        transactionCount: v.transactionCount ?? 0,
      })
    })
    return map
  }, [vendorBreakdown])

  const map = React.useMemo(() => new Map(shares.map((s) => [s.vendorId, s.sharePercentage])), [shares])
  const [local, setLocal] = React.useState<Record<string, number>>({})

  // The draft follows the provider and the saved shares (after a save, the refetched ones).
  React.useEffect(() => {
    if (!provider) return
    setLocal(shareDraft(provider.vendors, map))
  }, [provider, map])

  const total = React.useMemo(() => totalShare(local), [local])
  const hasChanges = React.useMemo(
    () => (provider ? hasShareChanges(provider.vendors, map, local) : false),
    [provider, local, map],
  )

  const loading = sharesLoading || analyticsLoading

  // One toast follows the save, as the legacy keyed message did: the busy toast gives way to the outcome.
  const doSave = async () => {
    if (!provider) return
    const busyToast = toast({ message: SHARES_SAVING, busy: true })
    try {
      const entries = Object.entries(local)
      await Promise.all(entries.map(([vendorId, pct]) =>
        upsertShare({ variables: shareUpsertVariables(provider.id, vendorId, pct) }),
      ))
      await refetch()
      toast.dismiss(busyToast)
      toast({ message: SHARES_SAVED, tone: 'ok', duration: SHARES_SAVED_MS })
      onClose()
      onSaved?.()
    } catch {
      toast.dismiss(busyToast)
      toast({ message: SHARES_FAILED, tone: 'error', duration: SHARES_FAILED_MS })
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Manage Vendor Shares"
      size="md"
      footer={(
        <div className={styles.drawerFooter}>
          <p className={styles.footerHint}>
            <IconInfoCircle size={15} stroke={strokeFor(15)} aria-hidden="true" />
            Configure vendor revenue share percentages for this provider
          </p>
          <div className={styles.footerActions}>
            <Button
              size="sm"
              icon={<IconArrowBackUp size={15} stroke={strokeFor(15)} />}
              onClick={() => {
                if (!provider) return
                setLocal(shareDraft(provider.vendors, map))
              }}
            >
              Reset
            </Button>
            <Button size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<IconCheck size={15} stroke={strokeFor(15)} />}
              loading={saving}
              disabled={!hasChanges}
              onClick={() => void doSave()}
            >
              Save Changes
            </Button>
          </div>
        </div>
      )}
    >
      {loading && !provider ? (
        <LoadingState label="Loading vendor shares" minHeight={192} />
      ) : provider ? (
        <div className={styles.drawerBody}>
          <section className={styles.section} aria-labelledby={summaryId}>
            <h3 id={summaryId} className={styles.sectionTitle}>Vendor Share Summary</h3>
            <p className={styles.sectionSub}>Total vendors, share percentage, and configuration status</p>
            <dl className={styles.summary}>
              <div className={styles.summaryItem}>
                <dt className={styles.summaryTerm}>Vendors</dt>
                <dd className={styles.summaryValue}>{provider.vendors.length || 0}</dd>
              </div>
              <div className={styles.summaryItem}>
                <dt className={styles.summaryTerm}>Total Share</dt>
                <dd className={clsx(styles.summaryValue, TOTAL_TONE_CLASS[totalShareTone(total)])}>
                  {total.toFixed(1)}%
                </dd>
              </div>
              <div className={styles.summaryItem}>
                <dt className={styles.summaryTerm}>Configured</dt>
                <dd className={styles.summaryValue}>
                  {configuredCount(local)}/{provider.vendors.length || 0}
                </dd>
              </div>
            </dl>
          </section>

          {loading && (
            <p className={styles.inlineLoading} role="status">
              <Spinner size="sm" decorative />
              <span>Loading vendor shares…</span>
            </p>
          )}

          {total > 100 && (
            <Notice
              tone="warn"
              live="polite"
              icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
              title="Total share exceeds 100%"
            >
              Your vendor shares total more than 100%. This is allowed but please verify it's intentional.
            </Notice>
          )}

          {hasChanges && (
            <Notice
              tone="info"
              live="polite"
              icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
              title="You have unsaved changes"
            >
              Click 'Save Changes' to apply your modifications.
            </Notice>
          )}

          <section className={styles.section} aria-labelledby={configurationId}>
            <h3 id={configurationId} className={styles.sectionTitle}>Vendor Share Configuration</h3>
            <p className={styles.sectionSub}>Configure revenue share percentages for each vendor</p>
            {provider.vendors.length > 0 ? (
              <ul className={styles.list}>
                {provider.vendors.map((v) => (
                  <VendorShareRow
                    key={v.id}
                    vendor={v}
                    providerId={provider.id}
                    value={local[v.id] ?? 0}
                    onChange={(val) => setLocal((prev) => ({ ...prev, [v.id]: val }))}
                    analytics={analyticsMap.get(v.id)}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No vendors found for this provider"
                icon={<IconInbox size={20} stroke={strokeFor(20)} />}
                inset="none"
              />
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}
