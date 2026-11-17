export type PlayerTypeLike = string | null | undefined

/**
 * Credit players: only these two types. Their chips sit in wallets.cash and bets use the
 * cash-wallet path, but chips move only through the upline (Deposit/Withdraw), so they get
 * no self-service deposit or withdrawal, no bonus or wagering and no referral cash.
 */
export function isCreditPlayer(playerType: PlayerTypeLike): boolean {
  return playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
}
