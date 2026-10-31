import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useMutation, useQuery } from '@apollo/client'
import { CREATE_TEST_MATKA_BET } from '@/lib/graphql/matkaLive'
import { MATKA_CATALOG_QUERY as MATKAS_QUERY } from '@/lib/graphql/matka'
import { Button } from '@/ui/components/Button'
import { Form } from '@/ui/components/Form'
import { NumberField } from '@/ui/components/NumberField'
import { TextField } from '@/ui/components/TextField'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { Notice } from '@/ui/components/Notice'
import { useForm } from '@/ui/form/useForm'
import { toast } from '@/ui/components/toast'
import styles from '../../MatkaLiveUi.module.css'
const required = (label: string) => z.string().min(1, `Please enter ${label}`)
const positive = (label: string) => z.number().nullable().refine(value => value != null && value >= 1, `Please enter ${label} of at least 1`)
const schema = z.object({ userId: positive('User ID'), matkaId: required('Matka'), matkaType: required('Matka Type'), marketName: required('Market Name'), marketSession: z.string(), bidType: required('Bid Type'), betNumbers: required('Bet Numbers'), betAmount: positive('Bet Amount'), payoutMultiplier: positive('Payout Multiplier'), potentialWin: z.number().nullable().refine(value => value == null || value >= 0, 'Potential Win cannot be negative'), count: positive('Count').refine(value => value != null && value <= 50, 'Count must be at most 50'), status: z.string() })
type Values = z.infer<typeof schema>
interface MatkaOption { id: string; name: string; code: string }
export function TestBetsPanel() {
  const [placing, setPlacing] = useState(false)
  const [search, setSearch] = useState('')
  const { data: matkasData, loading: matkasLoading, error: matkasError, refetch } = useQuery<{ matkas: { items: MatkaOption[] } }>(MATKAS_QUERY, { variables: { filters: { status: 'ACTIVE' } }, errorPolicy: 'all', fetchPolicy: 'network-only' })
  const matkas = useMemo(() => matkasData?.matkas?.items || [], [matkasData?.matkas?.items])
  const [createBet] = useMutation(CREATE_TEST_MATKA_BET, { errorPolicy: 'all' })
  const matkaOptions = useMemo(() => (search ? matkas.filter(matka => matka.name?.toLowerCase().includes(search.toLowerCase()) || matka.code?.toLowerCase().includes(search.toLowerCase())) : matkas).map(matka => ({ label: `${matka.name} (${matka.code})`, value: matka.id })), [matkas, search])
  const onPlace = async (values: Values) => {
    const { userId, matkaId, matkaType, marketName, marketSession, bidType, betNumbers, betAmount, payoutMultiplier, potentialWin, count, status } = values
    if (!userId || !matkaId || !matkaType || !marketName || !bidType || !betNumbers || !betAmount || !payoutMultiplier || !count) throw new Error('Fill all required fields')
    setPlacing(true)
    const ids: string[] = []
    try {
      for (let index = 0; index < Number(count); index++) {
        const result = await createBet({ variables: { input: { userId: Number(userId), matkaId: String(matkaId), matkaType, marketName: String(marketName), marketSession: marketSession || undefined, bidType: String(bidType), betNumbers: String(betNumbers), betAmount: Number(betAmount), payoutMultiplier: Number(payoutMultiplier), potentialWin: potentialWin != null ? Number(potentialWin) : undefined, status: status || undefined } } })
        if (result.errors?.length) throw new Error(result.errors[0].message)
        const id = result.data?.createTestMatkaBet?.id
        if (!id) throw new Error('The server did not confirm a created test bet')
        ids.push(id)
      }
      toast({ tone: 'ok', message: `Placed ${ids.length} test bet(s)` }); form.setValue('betNumbers', '')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Failed to create test bets'
      throw new Error(ids.length ? `${ids.length} test bet(s) were created before the remaining request failed. Review those bets before retrying. ${reason}` : reason)
    } finally { setPlacing(false) }
  }
  const form = useForm<Values>({ schema, initialValues: { userId: 1, matkaId: '', matkaType: 'worli', marketName: 'OPEN', marketSession: '', bidType: 'single', betNumbers: '', betAmount: 100, payoutMultiplier: 9, potentialWin: null, count: 1, status: '' }, onSubmit: onPlace })
  const busy = placing || form.submitting
  return <Form aria-label="Test Matka bets" onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.stack}>
    <h3 className={styles.heading}>Test Matka bets (dev)</h3>
    <Notice title="Test data creation" tone="warn">Submitting this form creates test bets through the existing server action. No bets are created until you submit.</Notice>
    {form.formError && <Notice title="Test bets not completed" tone="error" live="assertive">{form.formError}</Notice>}
    {matkasError && <Notice tone="error" action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>}>{matkasError.message}</Notice>}
    <div className={styles.grid3}>
      <NumberField label="User ID" min={1} {...form.field('userId')} required disabled={busy} />
      <Combobox label="Matka" name="matkaId" value={form.values.matkaId || null} onChange={value => form.setValue('matkaId', value || '')} onBlur={form.field('matkaId').onBlur} onInputChange={setSearch} filter={false} options={matkaOptions} error={form.errors.matkaId} loading={matkasLoading} placeholder={matkasLoading ? 'Loading matkas...' : 'Select matka'} emptyText={matkasLoading ? 'Loading...' : 'No matkas found'} clearable required disabled={busy} />
      <Select label="Matka Type" layout="stacked" {...form.field('matkaType')} options={[{ label: 'Worli', value: 'worli' }, { label: 'Starline', value: 'starline' }, { label: 'Jackpot', value: 'jackpot' }]} required disabled={busy} />
      <TextField label="Market Name" {...form.field('marketName')} placeholder="e.g., OPEN, CLOSE" required disabled={busy} />
      <TextField label="Market Session" {...form.field('marketSession')} placeholder="Optional" disabled={busy} />
      <TextField label="Bid Type" {...form.field('bidType')} placeholder="e.g., single, double, triple" required disabled={busy} />
      <TextField label="Bet Numbers" {...form.field('betNumbers')} placeholder="e.g., 123, 456" required disabled={busy} />
      <NumberField label="Bet Amount" min={1} {...form.field('betAmount')} required disabled={busy} />
      <NumberField label="Payout Multiplier" min={1} step={0.1} {...form.field('payoutMultiplier')} required disabled={busy} />
      <NumberField label="Potential Win" min={0} {...form.field('potentialWin')} placeholder="Auto-calculated if empty" disabled={busy} />
      <NumberField label="Count" min={1} max={50} {...form.field('count')} required disabled={busy} />
      <Select label="Status" layout="stacked" {...form.field('status')} options={[{ label: 'Leave empty for pending', value: '' }, ...['pending', 'active', 'won', 'lost', 'cancelled', 'void'].map(value => ({ label: value.toUpperCase(), value }))]} disabled={busy} />
    </div>
    <div className={styles.inline}><Button variant="primary" type="submit" loading={busy}>Place test bet(s)</Button></div>
  </Form>
}

