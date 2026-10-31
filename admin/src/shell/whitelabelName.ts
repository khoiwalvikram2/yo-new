import { initialsOf } from '@/ui/components/initials'

export const DEFAULT_BRAND_NAME = 'GameDash'
export const DEFAULT_BRAND_INITIALS = 'GD'

export interface ShellWhitelabelSource {
  id: string
  name?: string | null
}

/** null when missing, id === 'default', or name missing/blank (decision 8); else the trimmed name. */
export function shellWhitelabelName(whitelabel: ShellWhitelabelSource | null | undefined): string | null {
  if (!whitelabel || whitelabel.id === 'default') return null
  const trimmed = whitelabel.name?.trim()
  return trimmed ? trimmed : null
}

/** initialsOf(name, DEFAULT_BRAND_INITIALS) — decision 14 */
export function brandInitials(name: string | null): string {
  return initialsOf(name, DEFAULT_BRAND_INITIALS)
}
