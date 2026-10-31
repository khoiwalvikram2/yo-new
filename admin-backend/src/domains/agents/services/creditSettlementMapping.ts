/**
 * PURE helper: maps a settled bet's (stake, gross return) to the (betResult, payoutAmount)
 * pair BetCreditValidationService.releaseCreditForBet expects. Net P&L = gross - stake.
 *
 * releaseCreditForBet moves a credit player's settlement balance by +payoutAmount on 'win'
 * and by -payoutAmount on 'loss' (falling back to -betAmount when payoutAmount is 0), so the
 * settlement balance must receive the NET P&L. matka_bets.actual_win and casino_bets.payout
 * are GROSS (stake included); passing them as a win's payoutAmount overstates it by the stake.
 *
 * Mirrors user-backend's mapCasinoSettlementToCredit, rounded to cents. The rounding happens
 * before the win/loss split, so a shortfall under half a cent is a 0 win and never a
 * { loss, 0 }, which releaseCreditForBet would read as a full-stake loss.
 */
export type GrossCreditSettlement = { betResult: 'win' | 'loss'; payoutAmount: number }

export function mapGrossSettlementToCredit(stake: number, grossReturn: number): GrossCreditSettlement {
	if (!Number.isFinite(stake) || !Number.isFinite(grossReturn) || grossReturn < 0) {
		throw new RangeError(`Invalid settlement amounts: stake ${stake}, gross return ${grossReturn}`)
	}
	const pl = Math.round((grossReturn - stake) * 100) / 100
	// Math.abs also turns a -0 from the rounding into 0.
	if (pl >= 0) return { betResult: 'win', payoutAmount: Math.abs(pl) }
	return { betResult: 'loss', payoutAmount: Math.abs(pl) }
}
