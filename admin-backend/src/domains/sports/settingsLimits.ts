/**
 * The stake and odds limits a sport, league or event settings row, and a
 * whitelabel's default stake limits, must keep.
 *
 * The editors stored whatever arrived. A Min Stake above the Max Stake saved
 * with a success toast, and user-backend then refused every stake on that event
 * ("Minimum stake is 5000" / "Maximum stake is 100"), so the event silently
 * became unbettable for the brand. Odds below 1.01, the lowest decimal price, or
 * a Min Odds above the Max Odds did the same to every price.
 *
 * A limit that is not set is not checked: the player side falls back to the
 * next level up for it.
 */

const STAKE_DOMAINS = [['exchange', 'Exchange'], ['bookmaker', 'Bookmaker'], ['fancy', 'Fancy']] as const

/** The lowest decimal price; user-backend's own default minimum. */
export const MIN_DECIMAL_ODDS = 1.01

function setNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** One domain's min and max stake: a message, or null when they agree (or either is unset). */
export function stakePairProblem(label: string, min: unknown, max: unknown): string | null {
  const low = setNumber(min)
  const high = setNumber(max)
  if (low !== null && low < 0) return `${label} Min Stake cannot be negative.`
  if (high !== null && high < 0) return `${label} Max Stake cannot be negative.`
  if (low !== null && high !== null && low > high) {
    return `${label} Min Stake (${low}) cannot exceed ${label} Max Stake (${high}).`
  }
  return null
}

/** The first contradiction in a settings row's stake and odds limits, or null when there is none. */
export function sportsLimitsProblem(values: Record<string, unknown>): string | null {
  for (const [domain, label] of STAKE_DOMAINS) {
    const problem = stakePairProblem(label, values[`${domain}MinStake`], values[`${domain}MaxStake`])
    if (problem) return problem
  }
  const minOdds = setNumber(values.exchangeMinOdds)
  const maxOdds = setNumber(values.exchangeMaxOdds)
  if (minOdds !== null && minOdds < MIN_DECIMAL_ODDS) return `Min Odds must be at least ${MIN_DECIMAL_ODDS}.`
  if (maxOdds !== null && maxOdds < MIN_DECIMAL_ODDS) return `Max Odds must be at least ${MIN_DECIMAL_ODDS}.`
  if (minOdds !== null && maxOdds !== null && minOdds > maxOdds) {
    return `Min Odds (${minOdds}) cannot exceed Max Odds (${maxOdds}).`
  }
  return null
}

/** The default stake limits of app config (`exchangeMin`/`exchangeMax`, ...): the first contradiction, keyed by its field. */
export function defaultStakeLimitsProblem(limits: Record<string, unknown>): { field: string; message: string } | null {
  for (const [domain, label] of STAKE_DOMAINS) {
    const message = stakePairProblem(label, limits[`${domain}Min`], limits[`${domain}Max`])
    if (message) return { field: `${domain}Min`, message }
  }
  return null
}
