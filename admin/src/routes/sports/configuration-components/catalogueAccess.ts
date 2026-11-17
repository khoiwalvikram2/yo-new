import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

/* Sport, league, event and market status, and the sport and league order, belong to one catalogue every
 * whitelabel shares (the rows carry no whitelabel), and a player's bet is refused on anything inactive. The
 * server lets only the platform administrator change them, so anyone else is shown them read-only, with this
 * line saying why, rather than a switch that is refused. The stake limits and other settings beside them are
 * the whitelabel's own and stay editable. */
export const CATALOGUE_READ_ONLY_NOTE =
  'Status and order are shared by every whitelabel, so only the platform administrator can change them.'

export function useCanEditCatalogue(): boolean {
  const permissions = useAuthStore((state) => state.permissions)
  return hasPermissionWithNested(permissions ?? [], 'all', '*')
}
