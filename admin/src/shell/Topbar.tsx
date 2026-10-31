import { useLayoutEffect, useRef } from 'react'
import { IconMenu2 } from '@tabler/icons-react'
import { IconButton } from '@/ui/components/IconButton'
import { Breadcrumb } from '@/ui/components/Breadcrumb'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { GlobalSearch } from '@/shared/ui/GlobalSearch'
import type { BurgerProps } from './useNavDrawer'
import { useSearchHotkey } from './topbar/useSearchHotkey'
import { SearchTrigger } from './topbar/SearchTrigger'
import { SuperAdminSwitcher } from './topbar/SuperAdminSwitcher'
import { TenantCurrencyControls } from './topbar/TenantCurrencyControls'
import { WhitelabelWallet } from './topbar/WhitelabelWallet'
import { AgentCreditWallet } from './topbar/AgentCreditWallet'
import { AgentSharingWallet } from './topbar/AgentSharingWallet'
import { AgentCommissionWallet } from './topbar/AgentCommissionWallet'
import { DateTime } from './topbar/DateTime'
import { NotificationBell } from './topbar/NotificationBell'
import { ThemeToggle } from './topbar/ThemeToggle'
import { ProfileMenu } from './topbar/ProfileMenu'
import { useTopbarRoles } from './topbar/useTopbarRoles'
import styles from './Topbar.module.css'

export interface TopbarProps {
  showBurger: boolean
  burgerRef: (node: HTMLElement | null) => void
  burgerProps: BurgerProps
  onSearchOpen?: () => void
  /** The right tool rail is showing and carries Alerts and Tasks, so the topbar drops its two bells. */
  bellsInToolRail?: boolean
}

export function Topbar(props: TopbarProps) {
  const { showBurger, burgerRef, burgerProps, onSearchOpen, bellsInToolRail = false } = props
  const roles = useTopbarRoles()
  const { isWide, isSmallScreen } = useBreakpoint()
  const { open, setOpen } = useSearchHotkey()
  const wasOpenRef = useRef(false)

  // Covers the Ctrl/Cmd+K hotkey, which toggles `open` inside useSearchHotkey directly with no callback
  // hook: runs before the next paint, so the drawer closes in the same frame the search view opens. The
  // trigger's own click handler (openSearch, below) already covers the click path synchronously and first.
  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      onSearchOpen?.()
    }
    wasOpenRef.current = open
  }, [open, onSearchOpen])

  const openSearch = () => {
    onSearchOpen?.()
    setOpen(true)
  }

  return (
    <header className={styles.topbar} data-ui-radius="square">
      <div className={styles.left}>
        {showBurger && (
          <IconButton
            ref={burgerRef}
            label="Open navigation"
            icon={<IconMenu2 size={18} stroke={1.6} />}
            className={styles.burger}
            {...burgerProps}
          />
        )}
        {isWide && <Breadcrumb />}
      </div>
      <div className={styles.search}>
        <SearchTrigger onOpen={openSearch} />
      </div>
      <div className={styles.right}>
        {roles.isSuperAdmin && <SuperAdminSwitcher compact={isSmallScreen} />}
        {roles.showTenantCurrency && <TenantCurrencyControls compact={isSmallScreen} />}
        {roles.wallet === 'whitelabel' && <WhitelabelWallet compact={isSmallScreen} />}
        {roles.wallet === 'agentCredit' && <AgentCreditWallet compact={isSmallScreen} />}
        {roles.wallet === 'agentSharing' && <AgentSharingWallet compact={isSmallScreen} />}
        {roles.wallet === 'agentCommission' && <AgentCommissionWallet compact={isSmallScreen} />}
        <DateTime />
        <div className={styles.tools}>
          {roles.showGeneralBell && !bellsInToolRail && <NotificationBell category="general" />}
          {roles.showTaskBell && !bellsInToolRail && <NotificationBell category="task" />}
          <ThemeToggle />
        </div>
        <ProfileMenu userName={roles.userName} userRole={roles.userRole} />
      </div>
      <GlobalSearch isOpen={open} onClose={() => setOpen(false)} />
    </header>
  )
}
