export type PlayerTypeLike = string | null | undefined

/** Credit players (cash must stay 0; deposit/withdraw blocked). Only these two types. */
export function isCreditPlayer(playerType: PlayerTypeLike): boolean {
  return playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT'
}
