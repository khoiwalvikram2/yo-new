import { Link } from 'react-router-dom'
import { ROUTES } from '@/shared/core/constants'
import { useNeedsWhitelabelSelection } from '@/modules/matka/whitelabelScope'

/**
 * A dashboard player's name, linking to their profile. A Super Admin in core mode reads the dashboard's
 * insights across every whitelabel, but the players module reads one site (core mode reads the platform's
 * own), so the profile answered "Player not found" (PLA-05): there the name is plain text. Lists whose rows
 * come from the players module itself (the Top Players table) keep their links: the profile reads the same
 * tenant they do.
 */
export function DashboardPlayerName({ userId, username, linkClassName }: { userId: number; username: string; linkClassName?: string }) {
  const crossSite = useNeedsWhitelabelSelection()
  if (crossSite) return <span title="Switch to Whitelabel mode and select the player's site to open the profile">{username}</span>
  return <Link className={linkClassName} to={ROUTES.PLAYERS_PROFILE.replace(':playerId', String(userId))}>{username}</Link>
}
