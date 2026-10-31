import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { CREATE_TEST_CASINO_BET, SETTLE_TEST_CASINO_BET } from '@/lib/graphql/casinoLive'
import { CASINO_API_PROVIDERS, CASINO_GAMES } from '@/lib/graphql/casino'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { NumberField } from '@/ui/components/NumberField'
import { Select } from '@/ui/components/Select'
import { Combobox } from '@/ui/components/Combobox'
import { Notice } from '@/ui/components/Notice'
import { useForm } from '@/ui/form/useForm'
import { toast } from '@/ui/components/toast'
import styles from '../../CasinoLive.module.css'
const positive = (message: string) => z.number().nullable().refine(value => value !== null && value >= 1, message)
const schema = z.object({
  userId: positive('Please enter a User ID of at least 1'), providerId: z.string().min(1, 'Please select a provider'),
  category: z.string().min(1, 'Please select a category'), gameId: z.string().min(1, 'Please select a game'),
  stake: positive('Please enter a stake of at least 1'), count: positive('Please enter a count of at least 1').refine(value => value !== null && value <= 50, 'Count must be at most 50'),
  settleStatus: z.string(), payoutOnSettle: z.number().nullable().refine(value => value === null || value >= 0, 'Payout cannot be negative'),
})
type Values = z.infer<typeof schema>
interface OptionRow { id: string | number; name: string }
export function TestBetsPanel() {
  const [placing, setPlacing] = useState(false)
  const [search, setSearch] = useState('')
  const { data: providersData, loading: providersLoading, error: providersError } = useQuery<{ casinoApiProviders: OptionRow[] }>(CASINO_API_PROVIDERS, { errorPolicy: 'all' })
  const providers = useMemo(() => providersData?.casinoApiProviders || [], [providersData?.casinoApiProviders])
  const [fetchGames, { data: gamesData, loading: gamesLoading, error: gamesError }] = useLazyQuery<{ casinoGames: { items: OptionRow[] } }>(CASINO_GAMES, { fetchPolicy: 'network-only', errorPolicy: 'all' })
  const games = useMemo(() => gamesData?.casinoGames?.items || [], [gamesData?.casinoGames?.items])
  const [createBet] = useMutation(CREATE_TEST_CASINO_BET, { errorPolicy: 'all' })
  const [settleBet] = useMutation(SETTLE_TEST_CASINO_BET, { errorPolicy: 'all' })
  const providerOptions = useMemo(() => providers.map(provider => ({ label: provider.name, value: String(provider.id) })), [providers])
  const gameOptions = useMemo(() => games.map(game => ({ label: `${game.name} (#${game.id})`, value: String(game.id) })), [games])
  const onPlace = async (values: Values) => {
    const { userId, gameId, stake, count, payoutOnSettle, settleStatus, providerId, category } = values
    if (!userId || !gameId || !stake || !count || !providerId || !category) { toast({ tone: 'error', message: 'Fill all fields' }); return }
    setPlacing(true)
    try {
      const ids: string[] = []
      for (let index = 0; index < Number(count); index++) {
        const result = await createBet({ variables: { input: { userId: Number(userId), gameId: String(gameId), stake: Number(stake) } } })
        if (result.errors?.length) throw new Error(result.errors[0].message)
        const id = result?.data?.createTestCasinoBet?.id
        if (id) ids.push(id)
      }
      toast({ tone: 'ok', message: `Placed ${ids.length} test bet(s)` })
      if (settleStatus) {
        for (const id of ids) {
          const result = await settleBet({ variables: { id, payout: typeof payoutOnSettle === 'number' ? Number(payoutOnSettle) : null, status: settleStatus } })
          if (result.errors?.length) throw new Error(result.errors[0].message)
        }
        toast({ tone: 'ok', message: `Settled ${ids.length} bet(s) as ${settleStatus}` })
      }
    } catch {
      toast({ tone: 'error', message: 'Failed to create/settle test bets' })
    } finally { setPlacing(false) }
  }
  const form = useForm<Values>({ schema, initialValues: { userId: 1, providerId: '', category: 'CASINO', gameId: '', stake: 100, count: 1, settleStatus: '', payoutOnSettle: null }, onSubmit: onPlace })
  const providerId = form.values.providerId, category = form.values.category
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!providerId) return
      void fetchGames({ variables: { input: { providerId, category, search: search && search.length >= 2 ? search : undefined, page: 1, pageSize: 20 } } })
    }, 300)
    return () => clearTimeout(timer)
  }, [providerId, category, search, fetchGames])
  return <Card title="Test Bets Panel">
    <form noValidate onSubmit={form.handleSubmit} className={styles.stack} aria-label="Test casino bets">
      <h3 className={styles.heading}>Bet Configuration</h3>
      <div className={styles.grid3}>
        <NumberField label="User ID" min={1} {...form.field('userId')} required disabled={placing} />
        <Combobox label="Provider" name="providerId" value={providerId || null} onChange={value => { form.setValue('providerId', value || ''); setSearch('') }} onBlur={form.field('providerId').onBlur} error={form.errors.providerId} loading={providersLoading} placeholder={providersLoading ? 'Loading providers...' : 'Select provider'} clearable options={providerOptions} required disabled={placing} />
        <Select label="Category" layout="stacked" {...form.field('category')} options={[{ label: 'Live Casino', value: 'LIVE_CASINO' }, { label: 'Casino', value: 'CASINO' }, { label: 'Slots', value: 'SLOTS' }]} required disabled={placing} />
        <Combobox label="Game" name="gameId" value={form.values.gameId || null} onChange={value => form.setValue('gameId', value || '')} onBlur={form.field('gameId').onBlur} onInputChange={setSearch} error={form.errors.gameId} options={gameOptions} filter={false} loading={gamesLoading} placeholder={!providerId ? 'Select provider & type to search' : gamesLoading ? 'Searching...' : 'Type to search games'} emptyText={providerId ? gamesLoading ? 'Searching...' : 'No games' : 'Select provider first'} clearable required disabled={placing} />
        <NumberField label="Stake" min={1} {...form.field('stake')} required disabled={placing} />
        <NumberField label="Count" min={1} max={50} {...form.field('count')} required disabled={placing} />
      </div>
      <h3 className={styles.heading}>Settlement Options</h3>
      <div className={styles.grid2}><Select label="Settle as" layout="stacked" {...form.field('settleStatus')} options={[{ label: 'Leave empty to keep pending', value: '' }, { label: 'WON', value: 'won' }, { label: 'LOST', value: 'lost' }, { label: 'CANCELLED', value: 'cancelled' }, { label: 'VOID', value: 'void' }]} disabled={placing} /><NumberField label="Payout (optional)" min={0} {...form.field('payoutOnSettle')} disabled={placing} /></div>
      {providersError && <Notice tone="error">{providersError.message}</Notice>}{gamesError && <Notice tone="error">{gamesError.message}</Notice>}
      {form.errorCount > 0 && <Notice tone="error" live="assertive">{form.errorAnnouncement}</Notice>}
      <div className={styles.actions}><Button variant="primary" type="submit" loading={placing || form.submitting}>Place Test Bet(s)</Button></div>
    </form>
  </Card>
}

