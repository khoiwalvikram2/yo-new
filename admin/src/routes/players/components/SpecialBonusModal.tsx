import { useEffect, useState } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Combobox } from '@/ui/components/Combobox'
import { NumberField } from '@/ui/components/NumberField'
import { Notice } from '@/ui/components/Notice'
import { notify } from '@/shared/services/notification'
import styles from '../PlayersSearch.module.css'
const ACTIVE_SPECIAL_CAMPAIGNS = gql`
  query ActiveSpecialBonusCampaigns {
    activeSpecialBonusCampaigns {
      id
      name
      currency
      domain
    }
  }
`

const GRANT_SPECIAL_BONUS = gql`
  mutation GrantSpecialBonus($input: GrantSpecialBonusInput!) {
    grantSpecialBonus(input: $input) {
      success
      message
      bonus { id amount currency status }
    }
  }
`

interface SpecialBonusModalProps {
  open: boolean
  player: Player | null
  onClose: () => void
  onSuccess: () => void
}


export function SpecialBonusModal({ open, player, onClose, onSuccess }: SpecialBonusModalProps) {
  const [campaignId, setCampaignId] = useState<string | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [formError, setFormError] = useState('')
  const { data, loading: campaignsLoading, error } = useQuery<{ activeSpecialBonusCampaigns: { id: string; name: string; currency?: string }[] }>(ACTIVE_SPECIAL_CAMPAIGNS, { skip: !open, fetchPolicy: 'cache-and-network', errorPolicy: 'all' })
  const campaigns = data?.activeSpecialBonusCampaigns || []
  const [grant, { loading }] = useMutation(GRANT_SPECIAL_BONUS)
  useEffect(() => { if (!open) { setCampaignId(null); setAmount(null); setFormError('') } }, [open])
  async function submit() {
    if (!player?.id || loading) return
    if (!campaignId || amount == null || amount < 0.01) { setFormError('Please select a campaign and enter a positive amount'); notify.error('Please select a campaign and enter a positive amount'); return }
    setFormError('')
    try {
      const result = await grant({ variables: { input: { playerId: player.id, campaignId, amount: Number(amount) } }, context: { uiToast: 'notification' } })
      if (!result.data?.grantSpecialBonus?.success) throw new Error(result.data?.grantSpecialBonus?.message || 'Failed to grant special bonus')
      notify.success(result.data.grantSpecialBonus.message || 'Special bonus created'); setCampaignId(null); setAmount(null); onSuccess(); onClose()
    } catch (cause) { const message = cause instanceof Error ? cause.message : 'Failed to grant special bonus'; setFormError(message); notify.error(message) }
  }
  return <Dialog title="Grant Special Bonus" open={open} onOpenChange={next => { if (!next && !loading) onClose() }} dismissible={!loading} footer={<><Button disabled={loading} onClick={onClose}>Cancel</Button><Button variant="primary" loading={loading} onClick={() => void submit()}>Grant</Button></>}>
    <div className={styles.stack}><p className={styles.secondary}>Player: <strong>{player?.name || player?.username || player?.id}</strong>{player?.wallet?.currency && ' (Wallet: ' + player.wallet.currency + ')'}</p>
      <Combobox label="Campaign" value={campaignId} onChange={setCampaignId} options={campaigns.map(c => ({ value: c.id, label: c.name + (c.currency ? ' (' + c.currency + ')' : '') }))} loading={campaignsLoading} disabled={loading} placeholder="Select active Special Bonus campaign" />
      <NumberField label="Amount" value={amount} onChange={setAmount} min={0.01} step={1} grouping="en-US" disabled={loading} placeholder="Amount to grant" />
      {error && <Notice tone="error">{error.message}</Notice>}
      {!campaignsLoading && campaigns.length === 0 && open && <Notice tone="warn">No active Special Bonus campaigns. Create one from Bonuses first.</Notice>}
      {formError && <Notice tone="error" live="assertive">{formError}</Notice>}
    </div>
  </Dialog>
}
