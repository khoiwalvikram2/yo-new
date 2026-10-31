import { IconChevronDown, IconKey, IconLogout } from '@tabler/icons-react'
import { Avatar } from '@/ui/components/Avatar'
import { Menu, MenuItem, MenuSeparator } from '@/ui/components/Menu'
import styles from './ProfileMenu.module.css'

export interface ProfileMenuViewProps {
  userName: string
  userRole: string
  onChangePassword: () => void
  onSignOut: () => void
}

/**
 * Topbar profile menu, props only. The trigger's aria-label names the user, the role and the menu,
 * because below 768px CSS hides the visible name, role and chevron (spec decision 1). The kit Avatar
 * is aria-hidden. The menu holds exactly Change Password and Sign out.
 */
export function ProfileMenuView({ userName, userRole, onChangePassword, onSignOut }: ProfileMenuViewProps) {
  return (
    <Menu
      trigger={
        <button type="button" className={styles.trigger} aria-label={`${userName}, ${userRole}. Account menu.`}>
          <Avatar name={userName} />
          <span className={styles.stack}>
            <span className={styles.name}>{userName}</span>
            <span className={styles.role}>{userRole}</span>
          </span>
          <span className={styles.chevron} aria-hidden="true">
            <IconChevronDown size={15} stroke={1.75} />
          </span>
        </button>
      }
    >
      <MenuItem icon={<IconKey size={15} stroke={1.75} />} onSelect={onChangePassword}>
        Change Password
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<IconLogout size={15} stroke={1.75} />} onSelect={onSignOut}>
        Sign out
      </MenuItem>
    </Menu>
  )
}
