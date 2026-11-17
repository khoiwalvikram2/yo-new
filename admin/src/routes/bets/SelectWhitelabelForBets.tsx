import { Notice } from '@/ui/components/Notice'
import { SELECT_WHITELABEL_TITLE } from '@/routes/payments/paymentWhitelabelScope'

/**
 * Bets belong to one whitelabel. A Super Admin in core mode, or in whitelabel mode with no site selected
 * (usePaymentWhitelabelScope().selectionRequired), reads the platform's own tenant, which holds no bets, so a
 * bet list there showed every count at 0 as if the platform had none. The lists that read betsPage outside
 * the Bet List page (the casino and matka live Bet List tabs, a report contributor's bets) start no query
 * then and show this instead, as /bets does.
 */
export function SelectWhitelabelForBets() {
  return (
    <Notice tone="info" title={SELECT_WHITELABEL_TITLE}>
      Bets belong to one whitelabel. Switch to Whitelabel mode in the top bar and select the site whose bets you want to see.
    </Notice>
  )
}
