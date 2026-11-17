/**
 * Rules for a player created under an agent, with no database of their own so
 * they can be tested without one.
 */

export type AgentSchemeType = 'CREDIT' | 'SHARING' | 'COMMISSION'
export type AgentPlayerType = 'AGENT_CREDIT' | 'SHARING_AGENT_PLAYER' | 'COMMISSION_AGENT_PLAYER' | 'REGULAR'

/**
 * A player's type comes from its owning agent's scheme, never from the caller.
 *
 * `createPlayerForAgent` used to read `input.playerType` alongside the derived
 * type: an agent passing WHITELABEL_CREDIT got its new player's limit deducted
 * from the whitelabel credit pool, and passing AGENT_CREDIT switched on the
 * credit rules for a non-credit agent.
 */
export function playerTypeForAgentScheme(scheme: string | null | undefined): AgentPlayerType {
  switch (scheme) {
    case 'CREDIT':
      return 'AGENT_CREDIT'
    case 'SHARING':
      return 'SHARING_AGENT_PLAYER'
    case 'COMMISSION':
      return 'COMMISSION_AGENT_PLAYER'
    default:
      return 'REGULAR'
  }
}

export interface DomainFlags {
  sportsVisible: boolean
  sportsBetAllowed: boolean
  casinoVisible: boolean
  casinoBetAllowed: boolean
  matkaVisible: boolean
  matkaBetAllowed: boolean
}

/**
 * The domain flags a new player gets from its owning agent's `allowedDomains`
 * (owner decision 4: an agent's domains limit its players' betting).
 *
 * Replaces a hard-coded "sports and casino on, matka off", which gave a
 * matka-only agent players who could not play matka and a sports-only agent
 * players who could bet on casino. A domain the agent does not have is neither
 * visible nor bettable; one it has is both.
 */
export function bettingFlagsFromAgentDomains(allowedDomains: readonly string[] | null | undefined): DomainFlags {
  const domains = new Set(Array.isArray(allowedDomains) ? allowedDomains.map((d) => String(d).toLowerCase()) : [])
  const sports = domains.has('sports')
  const casino = domains.has('casino')
  const matka = domains.has('matka')
  return {
    sportsVisible: sports,
    sportsBetAllowed: sports,
    casinoVisible: casino,
    casinoBetAllowed: casino,
    matkaVisible: matka,
    matkaBetAllowed: matka,
  }
}

/**
 * The success message of a player creation, named by the player's type. Every type that was not a credit type
 * used to be announced as a "Regular player", including a commission or sharing agent's player.
 */
export function playerCreatedMessage(playerType: string | null | undefined): string {
  switch (playerType) {
    case 'AGENT_CREDIT':
    case 'WHITELABEL_CREDIT':
      return 'Credit player created successfully'
    case 'SHARING_AGENT_PLAYER':
      return 'Sharing player created successfully'
    case 'COMMISSION_AGENT_PLAYER':
      return 'Commission player created successfully'
    default:
      return 'Regular player created successfully'
  }
}
