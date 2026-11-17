import { isActiveEntityStatus } from '../statusNormalization.js'

/** The player fields the access flags are read from: a users row ('active') or a User mapper's object ('ACTIVE'). */
export interface PlayerAccessSource {
  status?: string | null
  withdrawalLock?: boolean | null
  bonusAllowed?: boolean | null
  sportsVisible?: boolean | null
  sportsBetAllowed?: boolean | null
  casinoVisible?: boolean | null
  casinoBetAllowed?: boolean | null
  matkaVisible?: boolean | null
  matkaBetAllowed?: boolean | null
}

/**
 * What a player may do (the PlayerAccess type). PlayerProfile.access and User.access both answer from here, so the
 * profile and any User a resolver returns (setUserStatus's reply, usersPage rows) cannot disagree.
 *
 * Only an active player may log in, deposit, withdraw, take a bonus or bet: the player API refuses every other status
 * at login ("Account is not active", user-backend authService), so an inactive player cannot log in either
 * (players/PLA-09). A domain's visibility is the player's own switch.
 */
export function playerAccess(user: PlayerAccessSource) {
  const active = isActiveEntityStatus(user.status)
  const domain = (visible: boolean | null | undefined, betAllowed: boolean | null | undefined) => ({
    visible: !!visible,
    canBet: active && !!betAllowed,
  })
  return {
    canLogin: active,
    canDeposit: active,
    canWithdraw: active && !user.withdrawalLock,
    bonusEligible: active && !!user.bonusAllowed,
    sports: domain(user.sportsVisible, user.sportsBetAllowed),
    casino: domain(user.casinoVisible, user.casinoBetAllowed),
    matka: domain(user.matkaVisible, user.matkaBetAllowed),
  }
}
