import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { useQuery, useMutation } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { PLAYER_CREDIT_ADJUSTMENTS_QUERY, ADJUST_PLAYER_CREDIT_MUTATION } from '@/lib/graphql/settlements'
import { notify } from '@/shared/services/notification'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { NumberField } from '@/ui/components/NumberField'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { useForm } from '@/ui/form/useForm'
import { profileCreditSchema, profileError, type PlayerProfile, type ProfileCreditAction } from '../profileModel'
import styles from '../PlayerProfile.module.css'
interface Adjustment { id: string; adjustmentType: string; amount?: number; balanceBefore?: number; balanceAfter?: number; previousLimit?: number; newLimit?: number; notes?: string; reason?: string; createdAt: string }
export function CreditManagementTab({ playerId, player, onRefetch }: { playerId: string; player: PlayerProfile; onRefetch?: () => void }) {
  const { getCurrencySymbol, formatAmount } = useCurrency()
  const { formatDate, formatTime } = useFormatDate()
  const permissions = useAuthStore((state) => state.permissions)
  const agent = useAuthStore((state) => state.agent)
  const canView = !!agent || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<ProfileCreditAction>('INCREASE')
  const limit = player?.creditLimit || 0
  const used = player?.creditUsed || 0
  const available = player?.creditAvailable || 0
  const money = (value?: number | null) => !canView ? '••••' : value == null ? '—' : formatAmount(Number(value))
  const { data, loading, error, refetch } = useQuery<{ playerCreditAdjustments: Adjustment[] }>(PLAYER_CREDIT_ADJUSTMENTS_QUERY, { variables: { playerId, limit: 50 }, fetchPolicy: 'cache-and-network', errorPolicy: 'all', skip: !playerId })
  const [adjustCredit, { loading: saving }] = useMutation(ADJUST_PLAYER_CREDIT_MUTATION)
  const schema = useMemo(() => profileCreditSchema(type, limit, available), [type, limit, available])
  const form = useForm<{ amount: number | null; notes: string }>({ schema, initialValues: { amount: null, notes: '' }, onSubmit: async (values) => {
    if (!playerId || values.amount == null) return
    let result
    try {
      result = await adjustCredit({ variables: { input: { playerId, adjustmentType: type, amount: values.amount, notes: values.notes || '' } } })
    } catch (cause) {
      notify.error(profileError(cause, 'Credit adjustment failed'), 'Adjustment Error')
      throw cause
    }
    if (!result.data?.adjustPlayerCredit?.success) { const message = result.data?.adjustPlayerCredit?.message || 'Credit adjustment failed'; notify.error(message, 'Adjustment Failed'); throw new Error(message) }
    notify.success(result.data.adjustPlayerCredit.message || 'Credit adjusted successfully', 'Credit Adjusted')
    setOpen(false); form.reset(); await refetch(); onRefetch?.()
  } })
  if (!player || !playerId) return <EmptyState title="Player data not available" />
  const rows = data?.playerCreditAdjustments || []
  const columns: DataTableColumn<Adjustment>[] = [
    { key: 'date', header: 'Date', cell: (row) => <div>{formatDate(row.createdAt, 'dd MMM yyyy')}<p className={styles.subtle}>{formatTime(row.createdAt, 'HH:mm')}</p></div> },
    { key: 'type', header: 'Type', cell: (row) => <StatusPill tone={row.adjustmentType === 'INCREASE' ? 'ok' : row.adjustmentType === 'DECREASE' ? 'neg' : row.adjustmentType === 'LIMIT_CHANGE' ? 'info' : 'neutral'}>{row.adjustmentType.replace('_', ' ')}</StatusPill> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (row) => money(row.amount) },
    { key: 'before', header: 'Balance Before', align: 'right', cell: (row) => money(row.balanceBefore) },
    { key: 'after', header: 'Balance After', align: 'right', cell: (row) => money(row.balanceAfter) },
    { key: 'previous', header: 'Previous Limit', align: 'right', cell: (row) => money(row.previousLimit) },
    { key: 'new', header: 'New Limit', align: 'right', cell: (row) => money(row.newLimit) },
    { key: 'reason', header: 'Reason', cell: (row) => row.reason || row.notes || '—' },
  ]
  const title = type === 'INCREASE' ? 'Increase Credit Limit' : type === 'DECREASE' ? 'Decrease Credit Limit' : 'Change Credit Limit'
  const busy = saving || form.submitting
  const show = (next: ProfileCreditAction) => { setType(next); form.reset(); setOpen(true) }
  return <div className={styles.stack}>
    <div className={clsx(styles.financialGrid, styles.creditGrid)}><Stat label="Credit Limit" value={<span className={styles.moneyValue}>{money(limit)}</span>} /><Stat label="Credit Used" value={<span className={styles.moneyValue}>{money(used)}</span>} /><Stat label="Available Credit" value={<span className={styles.moneyValue}>{money(available)}</span>} /></div>
    <Card title="Credit Management Actions" sub="Adjust credit limit and manage player credit"><div className={styles.row}><Button variant="primary" onClick={() => show('INCREASE')}>Increase Credit Limit</Button><Button variant="danger" onClick={() => show('DECREASE')}>Decrease Credit Limit</Button><Button onClick={() => show('LIMIT_CHANGE')}>Change Limit</Button></div></Card>
    {used > 0 ? <Notice title="Credit in Use" tone="warn">{`This player has ${money(used)} in credit usage. Adjustments will affect their available credit.`}</Notice> : null}
    <Card title="Credit Adjustment History" sub={`${rows.length} ${rows.length === 1 ? 'adjustment' : 'adjustments'}`} body="table">
      <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} label="Credit Adjustment History" pagination={false} state={loading ? 'loading' : error ? 'error' : 'ready'} error={error ? `Failed to load credit adjustments: ${error.message}` : undefined} onRetry={() => void refetch()} empty={<EmptyState title="No credit adjustments" />} />
    </Card>
    <Dialog title={title} description={player.name || player.username || 'Player'} open={open} onOpenChange={(next) => { if (!next && !busy) { setOpen(false); form.reset() } }} size="md" dismissible={!busy}>
      <Form onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.stack}>
        <DescriptionList items={[{ term: 'Current Limit', value: money(limit) }, { term: 'Credit Used', value: money(used) }, { term: 'Available', value: money(available) }]} />
        {form.formError ? <Notice tone="error" title="Adjustment not saved" live="assertive">{form.formError}</Notice> : null}
        <NumberField label="Amount" {...form.field('amount')} required min={0} step={100} grouping="en-US" prefix={getCurrencySymbol()} disabled={busy} />
        <Textarea label="Notes" {...form.field('notes')} rows={3} placeholder="Enter adjustment reason/notes" maxLength={500} showCount disabled={busy} />
        <div className={styles.actions}><Button onClick={() => { setOpen(false); form.reset() }} disabled={busy}>Cancel</Button><Button type="submit" variant={type === 'DECREASE' ? 'dangerSolid' : 'primary'} loading={busy}>{type === 'INCREASE' ? 'Increase Limit' : type === 'DECREASE' ? 'Decrease Limit' : 'Change Limit'}</Button></div>
      </Form>
    </Dialog>
  </div>
}

