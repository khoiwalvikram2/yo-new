import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Switch } from '@/ui/components/Switch'
import { NumberField } from '@/ui/components/NumberField'
import type { FormApi } from '@/ui/form/useForm'
import { PLAYER_LIMITS, type PlayerCreateValues } from '../playerCreateModel'
import styles from '../PlayerCreateForm.module.css'

export default function BettingControls({ form }: { form: FormApi<PlayerCreateValues> }) {
  const { getCurrencySymbol } = useCurrency()
  const active = form.values.status === 'active'
  const suspended = form.values.status === 'suspended'
  return <Card title="Betting Controls"><div className={styles.stack}>
    <div className={styles.domains}>{(['sports', 'casino', 'matka'] as const).map((domain) => {
      const visible = `${domain}Visible` as 'sportsVisible' | 'casinoVisible' | 'matkaVisible'
      const allowed = `${domain}BetAllowed` as 'sportsBetAllowed' | 'casinoBetAllowed' | 'matkaBetAllowed'
      return <Card key={domain} title={`${domain[0].toUpperCase() + domain.slice(1)} Betting`} headingLevel={3}>
        <div className={styles.stack}><Switch label="Visible" checked={form.values[visible]} disabled={suspended} onChange={(value) => form.setValue(visible, value)} />
          <Switch label="Betting Allowed" checked={form.values[allowed]} disabled={!active} onChange={(value) => form.setValue(allowed, value)} /></div>
      </Card>
    })}</div>
    <Card title="Stake and Bet Limits" headingLevel={3}><div className={styles.fields}>
      {PLAYER_LIMITS.map(({ key, label }) => <NumberField key={key} label={label} {...form.field(key)} value={form.values[key] ?? null} min={0} precision={2} prefix={getCurrencySymbol()} help="Leave empty for the existing default limit." />)}
    </div></Card>
  </div></Card>
}

