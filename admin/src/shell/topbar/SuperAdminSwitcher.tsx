import { SuperAdminSwitcherView } from './SuperAdminSwitcherView'
import { useSuperAdminMode } from './useSuperAdminMode'

export interface SuperAdminSwitcherProps {
  compact: boolean
}

/** Topbar Super Admin mode switcher. Mount only for Super Admin (Topbar.tsx:216 today; Task 49). */
export function SuperAdminSwitcher({ compact }: SuperAdminSwitcherProps) {
  const state = useSuperAdminMode()
  return <SuperAdminSwitcherView state={state} compact={compact} />
}
