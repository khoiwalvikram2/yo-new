import { NumberField } from '@/ui/components/NumberField'
import { Button } from '@/ui/components/Button'
import styles from '../../PlayersSearch.module.css'
import { useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { useCurrency } from '@/shared/core/CurrencyContext'

const UpsertPlayerLimits = gql`
  mutation UpsertPlayerLimits($input: PlayerLimitsInput!) {
    upsertPlayerLimits(input: $input) {
      success
      message
      limits {
        userId
        dailyStakeLimit
        weeklyStakeLimit
        exposureCapOverride
        cooldownSeconds
        maxBetSports
        maxBetCasino
        maxBetMatka
      }
    }
  }
`

interface LimitsSectionProps {
  user: Player
  saving: Record<string, boolean>
  setSavingFlag: (key: string, val: boolean) => void
  dailyStakeLimit: number | null
  setDailyStakeLimit: (val: number | null) => void
  weeklyStakeLimit: number | null
  setWeeklyStakeLimit: (val: number | null) => void
  exposureCapOverride: number | null
  setExposureCapOverride: (val: number | null) => void
  cooldownSeconds: number | null
  setCooldownSeconds: (val: number | null) => void
  maxBetSports: number | null
  setMaxBetSports: (val: number | null) => void
  maxBetCasino: number | null
  setMaxBetCasino: (val: number | null) => void
  maxBetMatka: number | null
  setMaxBetMatka: (val: number | null) => void
}

export function LimitsSection({
  user,
  saving,
  setSavingFlag,
  dailyStakeLimit,
  setDailyStakeLimit,
  weeklyStakeLimit,
  setWeeklyStakeLimit,
  exposureCapOverride,
  setExposureCapOverride,
  cooldownSeconds,
  setCooldownSeconds,
  maxBetSports,
  setMaxBetSports,
  maxBetCasino,
  setMaxBetCasino,
  maxBetMatka,
  setMaxBetMatka,
}: LimitsSectionProps) {
  const { formatAmount } = useCurrency()
  const [mutUpsertLimits] = useMutation(UpsertPlayerLimits)

  // Save all limits function
  const handleSaveAllLimits = async () => {
    if (!user) return
    try {
      setSavingFlag(`limits-${user.id}`, true)
      await mutUpsertLimits({
        variables: {
          input: {
            userId: user.id,
            dailyStakeLimit,
            weeklyStakeLimit,
            exposureCapOverride,
            cooldownSeconds,
            maxBetSports,
            maxBetCasino,
            maxBetMatka,
          },
        },
        context: { uiToast: 'message' },
        optimisticResponse: {
          upsertPlayerLimits: {
            __typename: 'PlayerLimitsPayload',
            success: true,
            message: 'Limits updated',
            limits: {
              __typename: 'PlayerLimits',
              userId: user.id,
              dailyStakeLimit,
              weeklyStakeLimit,
              exposureCapOverride,
              cooldownSeconds,
              maxBetSports,
              maxBetCasino,
              maxBetMatka,
            },
          },
        },
      })
    } catch { /* Apollo's existing notification link reports the mutation failure. */ } finally {
      setSavingFlag(`limits-${user.id}`, false)
    }
  }

  const fields = [
    { label: 'Daily Limit', value: dailyStakeLimit, set: setDailyStakeLimit, help: 'e.g. 10000 = player can stake only up to ' + formatAmount(10000) + ' in that day', placeholder: 'No limit' },
    { label: 'Weekly Limit', value: weeklyStakeLimit, set: setWeeklyStakeLimit, help: 'e.g. 20000 = player can stake only up to ' + formatAmount(20000) + ' in that week', placeholder: 'No limit' },
    { label: 'Exposure Cap', value: exposureCapOverride, set: setExposureCapOverride, help: "e.g. 5000 = user's total exposure cannot exceed " + formatAmount(5000), placeholder: 'Default' },
    { label: 'Cooldown (sec)', value: cooldownSeconds, set: setCooldownSeconds, help: 'e.g. 5 = minimum 5 seconds gap between one bet and the next', placeholder: '0' },
    { label: 'Sports', value: maxBetSports, set: setMaxBetSports, help: 'e.g. 1000 = single bet cannot exceed ' + formatAmount(1000), placeholder: 'No limit' },
    { label: 'Casino', value: maxBetCasino, set: setMaxBetCasino, help: 'e.g. 1000 = single bet cannot exceed ' + formatAmount(1000), placeholder: 'No limit' },
    { label: 'Matka', value: maxBetMatka, set: setMaxBetMatka, help: 'e.g. 1000 = single bet cannot exceed ' + formatAmount(1000), placeholder: 'No limit' },
  ]
  return <div className={styles.stack}><div><h3 className={styles.name}>Stake Limits</h3><p className={styles.secondary}>Maximum total stake the player can place in the given period. When set, the player cannot stake more than this amount in that day/week.</p></div><div className={styles.two}>{fields.slice(0,4).map(field => <NumberField key={field.label} label={field.label} min={0} value={field.value} onChange={field.set} help={field.help} placeholder={field.placeholder} />)}</div>
    <div><h3 className={styles.name}>Maximum Bet Limits</h3><p className={styles.secondary}>Maximum stake per single bet. When set, the player cannot place a bet larger than this amount in one go.</p></div><div className={styles.three}>{fields.slice(4).map(field => <NumberField key={field.label} label={field.label} min={0} value={field.value} onChange={field.set} help={field.help} placeholder={field.placeholder} />)}</div>
    <Button variant="primary" block size="sm" onClick={() => void handleSaveAllLimits()} loading={!!saving['limits-' + user.id]}>Save All Limits</Button>
  </div>
}
