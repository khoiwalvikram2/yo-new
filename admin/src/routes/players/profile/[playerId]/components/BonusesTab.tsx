import { useState } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { z } from 'zod'
import dayjs from 'dayjs'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { Meter } from '@/ui/components/Meter'
import { DescriptionList, type DescriptionListItem } from '@/ui/components/DescriptionList'
import { Dialog } from '@/ui/components/Dialog'
import { Form } from '@/ui/components/Form'
import { Select } from '@/ui/components/Select'
import { NumberField } from '@/ui/components/NumberField'
import { Textarea } from '@/ui/components/Textarea'
import { Notice } from '@/ui/components/Notice'
import { useForm } from '@/ui/form/useForm'
import styles from '../PlayerProfile.module.css'

const PLAYER_BONUSES_QUERY = gql`
  query PlayerBonuses($playerId: ID!) {
    playerBonuses(playerId: $playerId) {
      id
      campaignId
      type
      name
      domain
      amount
      currency
      status
      distributionType
      grantedAt
      completedAt
      expiresAt
      triggerAmount
      wageringRequirement
      wageringCompleted
      wageringRemaining
      firstDepositRequired
      firstDepositUnlocked
      contributionRules
      campaign {
        id
        name
        domain
        type
        status
        budgetNumeric
        currency
        codeMode
        validFrom
        validTo
        limitsJson
        directSubType
        depositConditionType
        depositConditionAmount
        distributionType
        amountType
        amount
        percentage
        numberOfPlayers
        usagePerPlayer
        startDate
        endDate
        wagering
        expiryBonusDays
        depositRequired
        releaseType
        distributedAt
        createdAt
        updatedAt
      }
    }
  }
`

const GRANT_PLAYER_BONUS = gql`
  mutation GrantPlayerBonus($input: GrantBonusInput!) {
    grantPlayerBonus(input: $input) {
      success
      message
      bonus { id type name amount currency status }
    }
  }
`

interface Campaign { id: string; name: string; domain: string; type: string; status: string; currency: string; budgetNumeric?: number; codeMode?: string; amount?: number; percentage?: number; wagering?: number; distributionType?: string; depositConditionAmount?: number; usagePerPlayer?: number; numberOfPlayers?: number; expiryBonusDays?: number; validFrom?: string; validTo?: string; startDate?: string; endDate?: string; distributedAt?: string; depositRequired?: boolean; releaseType?: string; directSubType?: string; createdAt: string; updatedAt: string; limitsJson?: Record<string, unknown>; rulesJson?: Record<string, unknown> }
interface PlayerBonus { id: string; campaignId: string; name: string; type: string; domain: string; amount: number; currency: string; status: string; distributionType?: string | null; wageringCompleted?: number; wageringRequirement?: number; triggerAmount?: number; firstDepositRequired?: boolean; firstDepositUnlocked?: boolean; grantedAt: string; completedAt?: string; expiresAt?: string; campaign?: Campaign }
const grantSchema = z.object({ bonusType: z.string().min(1, 'Select type'), amount: z.number().min(0.01, 'Must be positive').nullable().refine((value) => value != null, 'Enter amount'), currency: z.string(), reason: z.string() })
// This existing workflow is intentionally unavailable in the production navigation.
const GRANT_BONUS_ENABLED = false
export function BonusesTab({ playerId, currency: playerCurrency }: { playerId: string; currency?: string }) {
  const { formatAmount, getCurrencySymbol } = useCurrency()
  const { formatDate, formatTime, formatDateTime } = useFormatDate()
  const [grantModalOpen, setGrantModalOpen] = useState(false)
  const [networkErrorSkip, setNetworkErrorSkip] = useState(false)
  const [expandedBonusId, setExpandedBonusId] = useState<string | null>(null)
  const { data, loading, error, refetch } = useQuery<{ playerBonuses?: PlayerBonus[] }>(PLAYER_BONUSES_QUERY, {
    variables: { playerId }, skip: networkErrorSkip, errorPolicy: 'all', notifyOnNetworkStatusChange: false,
    onError: (cause) => { if (cause.networkError) setNetworkErrorSkip(true) },
  })
  const [grantBonus, { loading: granting }] = useMutation(GRANT_PLAYER_BONUS, { context: { uiToast: 'notification' } })
  const form = useForm({ schema: grantSchema, initialValues: { bonusType: 'manual', amount: null as number | null, currency: playerCurrency || 'INR', reason: '' }, onSubmit: async (values) => {
    const result = await grantBonus({ variables: { input: { playerId, bonusType: values.bonusType || 'manual', amount: Number(values.amount), currency: values.currency || playerCurrency || 'INR', reason: values.reason?.trim() || undefined } } })
    if (!result.data?.grantPlayerBonus?.success) throw new Error(result.data?.grantPlayerBonus?.message || 'Failed to grant bonus')
    setGrantModalOpen(false); form.reset(); void refetch()
  } })
  const busy = granting || form.submitting
  const closeGrant = () => { setGrantModalOpen(false); form.reset() }
  const retry = () => { setNetworkErrorSkip(false); void refetch() }
  const bonuses = data?.playerBonuses || []
  const getDistributionLabel = (dt?: string | null) => {
    if (!dt) return '-'
    const labels: Record<string, string> = {
      instant_otp: 'Instant (OTP)',
      instant_cash: 'Instant Cash',
      roll_over: 'Roll Over',
    }
    return labels[dt] || dt
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      deposit: 'Deposit',
      signup: 'Signup',
      direct_freebet: 'Free Bet',
      direct_free_spin: 'Free Spins',
      direct_amount: 'Direct Amount',
      referral_deposit: 'Referral Deposit',
      deposit_match: 'Deposit Match',
      cashback_loss: 'Cashback (Loss)',
      direct_event: 'Event Bonus',
      free_bet: 'Free Bet',
      free_spins: 'Free Spins',
      casino_credit: 'Casino Credit',
      loyalty: 'Loyalty',
      reload: 'Reload',
    }
    return labels[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }


  const date = (value?: string, missing = '—') => value ? <span>{formatDate(value, 'dd MMM yyyy')}<span className={styles.subtle}> · {formatTime(value, 'HH:mm')}</span></span> : missing
  const campaignDetails = (campaign: Campaign) => {
    const items: DescriptionListItem[] = [
      { term: 'Name', value: campaign.name }, { term: 'ID', value: `#${campaign.id}` }, { term: 'Domain', value: campaign.domain }, { term: 'Type', value: getTypeLabel(campaign.type) },
      { term: 'Status', value: <StatusPill status={campaign.status}>{campaign.status}</StatusPill> }, { term: 'Currency', value: campaign.currency },
      { term: 'Budget', value: formatAmount(campaign.budgetNumeric ?? 0, campaign.currency) }, { term: 'Code mode', value: String(campaign.codeMode ?? '-').replace(/_/g, ' ') },
    ]
    if (campaign.amount != null) items.push({ term: 'Amount', value: formatAmount(campaign.amount, campaign.currency) })
    if (campaign.percentage != null) items.push({ term: 'Percentage', value: `${campaign.percentage}%` })
    if (campaign.wagering != null) items.push({ term: 'Wagering', value: `${campaign.wagering}x` })
    if (campaign.distributionType) items.push({ term: 'Distribution', value: getDistributionLabel(campaign.distributionType) })
    if (campaign.depositConditionAmount != null) items.push({ term: 'Min deposit', value: formatAmount(campaign.depositConditionAmount, campaign.currency) })
    if (campaign.usagePerPlayer != null) items.push({ term: 'Usage per player', value: campaign.usagePerPlayer })
    if (campaign.numberOfPlayers != null) items.push({ term: 'Max players', value: campaign.numberOfPlayers })
    if (campaign.expiryBonusDays != null) items.push({ term: 'Expiry (days)', value: campaign.expiryBonusDays })
    if (campaign.validFrom) items.push({ term: 'Valid from', value: formatDateTime(campaign.validFrom, 'dd MMM yyyy HH:mm') })
    if (campaign.validTo) items.push({ term: 'Valid to', value: formatDateTime(campaign.validTo, 'dd MMM yyyy HH:mm') })
    if (campaign.startDate) items.push({ term: 'Start date', value: formatDate(campaign.startDate, 'dd MMM yyyy') })
    if (campaign.endDate) items.push({ term: 'End date', value: formatDate(campaign.endDate, 'dd MMM yyyy') })
    if (campaign.distributedAt) items.push({ term: 'Distributed at', value: formatDateTime(campaign.distributedAt, 'dd MMM yyyy HH:mm') })
    items.push({ term: 'Deposit required', value: campaign.depositRequired ? 'Yes' : 'No' })
    if (campaign.releaseType) items.push({ term: 'Release type', value: String(campaign.releaseType).replace(/_/g, ' ') })
    if (campaign.directSubType) items.push({ term: 'Direct sub-type', value: campaign.directSubType })
    items.push({ term: 'Created', value: formatDateTime(campaign.createdAt, 'dd MMM yyyy HH:mm') }, { term: 'Updated', value: formatDateTime(campaign.updatedAt, 'dd MMM yyyy HH:mm') })
    return <div className={styles.detail}><DescriptionList.Section title="Campaign details"><DescriptionList items={items} /></DescriptionList.Section>
      {campaign.limitsJson && typeof campaign.limitsJson === 'object' && Object.keys(campaign.limitsJson).length ? <DescriptionList.Section title="Limits (JSON)"><pre className={styles.json}>{JSON.stringify(campaign.limitsJson, null, 2)}</pre></DescriptionList.Section> : null}
      {campaign.rulesJson && typeof campaign.rulesJson === 'object' && Object.keys(campaign.rulesJson).length ? <DescriptionList.Section title="Rules (JSON)"><pre className={styles.json}>{JSON.stringify(campaign.rulesJson, null, 2)}</pre></DescriptionList.Section> : null}
    </div>
  }
  const columns: DataTableColumn<PlayerBonus>[] = [
    { key: 'name', header: 'Bonus', minWidth: 210, cell: (row) => <span>{row.name}<span className={styles.subtle}> · {getTypeLabel(row.type)} · #{row.campaignId}</span></span> },
    { key: 'domain', header: 'Domain', align: 'center', minWidth: 100, cell: (row) => <StatusPill tone="neutral">{row.domain}</StatusPill> },
    { key: 'amount', header: 'Amount', align: 'right', minWidth: 140, cell: (row) => formatAmount(row.amount || 0, row.currency) },
    { key: 'distributionType', header: 'Distribution', align: 'center', minWidth: 150, cell: (row) => getDistributionLabel(row.distributionType) },
    { key: 'status', header: 'Status', align: 'center', minWidth: 110, cell: (row) => <StatusPill status={row.status}>{row.status}</StatusPill> },
    { key: 'wagering', header: 'Wagering Progress', minWidth: 190, cell: (row) => {
      const required = row.wageringRequirement || 0; const completed = row.wageringCompleted || 0
      const percent = required > 0 ? Math.min(100, completed / required * 100) : 0
      return required > 0 ? <span className={styles.progress}><Meter value={Math.round(percent)} label={`Wagering progress for ${row.name}`} tone={percent >= 100 ? 'acc' : 'warn'} /><span className={styles.subtle}>{formatAmount(completed, row.currency)} / {formatAmount(required, row.currency)}</span></span> : 'No wagering'
    } },
    { key: 'triggerAmount', header: 'Trigger', align: 'right', minWidth: 120, cell: (row) => row.triggerAmount ? formatAmount(row.triggerAmount, row.currency) : '-' },
    { key: 'lock', header: 'Deposit Lock', align: 'center', minWidth: 160, cell: (row) => row.firstDepositRequired ? <StatusPill tone={row.firstDepositUnlocked ? 'ok' : 'warn'}>{row.firstDepositUnlocked ? 'Deposit made — unlocked' : 'Awaiting first deposit'}</StatusPill> : '-' },
    { key: 'grantedAt', header: 'Granted', minWidth: 155, cell: (row) => date(row.grantedAt) },
    { key: 'completedAt', header: 'Completed', minWidth: 155, cell: (row) => date(row.completedAt, 'Pending') },
    { key: 'expiresAt', header: 'Expires', minWidth: 155, cell: (row) => <span>{date(row.expiresAt, 'Never')}{row.expiresAt && dayjs(row.expiresAt).isBefore(dayjs()) ? <StatusPill tone="neg">EXPIRED</StatusPill> : null}</span> },
    { key: 'campaign', header: 'Campaign', align: 'center', minWidth: 110, cell: (row) => row.campaign ? <Button size="xs" variant="ghost" onClick={() => setExpandedBonusId(expandedBonusId === row.id ? null : row.id)} aria-expanded={expandedBonusId === row.id}>{expandedBonusId === row.id ? 'Hide' : 'Details'}</Button> : '-' },
  ]
  return <div className={styles.stack}>
    <Card title="Bonuses" sub={`${bonuses.length} ${bonuses.length === 1 ? 'bonus' : 'bonuses'}`} body="table" tools={<>
      {/* Grant Bonus remains intentionally hidden, as in the original production UI. */}
      {GRANT_BONUS_ENABLED && <RBACGuard required={[{ domain: 'players.bonuses', actions: ['create'] }]}><Button variant="primary" onClick={() => setGrantModalOpen(true)}>Grant Bonus</Button></RBACGuard>}
    </>}>
      <DataTable columns={columns} rows={error || networkErrorSkip ? [] : bonuses} rowKey={(row) => row.id} label="Player bonuses" width="wide" state={loading ? 'loading' : error || networkErrorSkip ? 'error' : 'ready'} error="Error loading bonuses" onRetry={retry} expandable={{ expanded: new Set(expandedBonusId ? [expandedBonusId] : []), onToggle: (id) => setExpandedBonusId(expandedBonusId === id ? null : id), render: (row) => row.campaign ? campaignDetails(row.campaign) : 'No campaign details available' }} />
    </Card>
    <Dialog title="Grant Bonus" open={grantModalOpen} onOpenChange={(next) => { if (!next && !busy) closeGrant() }} size="sm" dismissible={!busy}>
      <Form onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.stack}>
        {form.formError ? <Notice tone="error" title="Bonus not granted" live="assertive">{form.formError}</Notice> : null}
        <Select label="Bonus Type" layout="stacked" {...form.field('bonusType')} required disabled={busy} options={[{ value: 'manual', label: 'Manual Bonus' }, { value: 'welcome', label: 'Welcome Bonus' }, { value: 'deposit', label: 'Deposit Bonus' }, { value: 'reload', label: 'Reload Bonus' }, { value: 'referral', label: 'Referral Bonus' }, { value: 'promotional', label: 'Promotional Bonus' }, { value: 'compensation', label: 'Compensation' }, { value: 'other', label: 'Other' }]} />
        <NumberField label={`Amount ${playerCurrency ? `(${getCurrencySymbol(playerCurrency)})` : ''}`} {...form.field('amount')} min={0.01} step={0.01} placeholder="0.00" required disabled={busy} />
        <Select label="Currency" layout="stacked" {...form.field('currency')} disabled={busy} options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]} />
        <Textarea label="Reason" {...form.field('reason')} rows={3} placeholder="Reason for this bonus (e.g. Promotional offer)" maxLength={500} showCount disabled={busy} />
        <div className={styles.actions}><Button onClick={closeGrant} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" loading={busy}>Grant Bonus</Button></div>
      </Form>
    </Dialog>
  </div>
}

