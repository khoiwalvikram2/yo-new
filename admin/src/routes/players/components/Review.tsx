import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import type { FormApi } from '@/ui/form/useForm'
import { PLAYER_LIMITS, givesOpeningChips, isCreditPlayer, type PlayerCreateValues } from '../playerCreateModel'
import styles from '../PlayerCreateForm.module.css'

export default function Review({ form }: { form: FormApi<PlayerCreateValues> }) {
  const value = form.values
  const { formatAmount } = useCurrency()
  return <Card title="Review Player Information"><div className={styles.review}><DescriptionList items={[
    { term: 'Full Name', value: value.name }, { term: 'Username', value: value.username || 'Auto-generated' },
    { term: 'Phone Number', value: value.dialCode ? `+${value.dialCode} ${value.phone}` : value.phone },
    { term: 'Email Address', value: value.email || '—' }, { term: 'Player Type', value: value.playerType },
    ...(value.agentId ? [{ term: 'Agent', value: value.agentId }] : []),
    ...(isCreditPlayer(value.playerType) ? [{ term: 'Credit Reference', value: formatAmount(Number(value.creditLimit ?? 0), value.currency) }] : []),
    // The admin's review (the agent form has none): a whitelabel credit player's opening chips come from the pool, an
    // agent credit player's from its agent's chips.
    ...(givesOpeningChips(value, false) ? [{ term: 'Opening Chips', value: formatAmount(Number(value.openingChips ?? 0), value.currency) }] : []),
    { term: 'Initial Balance', value: formatAmount(0, value.currency) }, { term: 'Currency', value: value.currency },
    { term: 'Account Status', value: <StatusPill status={value.status}>{value.status}</StatusPill> },
    { term: 'Risk Type', value: value.riskType || 'Default' },
    // Credit players have no VIP tier; anyone else without a pick starts on Automatic.
    ...(isCreditPlayer(value.playerType) ? [] : [{ term: 'VIP Tier', value: value.vipTierName || value.vipTier || 'Automatic (monthly deposits)' }]),
    { term: 'Require Password Reset', value: value.requirePasswordReset ? 'Yes' : 'No' }, { term: 'Bonus Eligibility', value: value.bonusAllowed ? 'Yes' : 'No' },
    ...(['sports', 'casino', 'matka'] as const).flatMap((domain) => [
      { term: `${domain[0].toUpperCase() + domain.slice(1)} Visible`, value: value[`${domain}Visible`] ? 'Yes' : 'No' },
      { term: `${domain[0].toUpperCase() + domain.slice(1)} Betting`, value: value[`${domain}BetAllowed`] ? 'Yes' : 'No' },
    ]),
    ...PLAYER_LIMITS.map(({ key, label }) => ({ term: label, value: value[key] == null ? 'Default' : formatAmount(Number(value[key]), value.currency) })),
  ]} /></div></Card>
}
