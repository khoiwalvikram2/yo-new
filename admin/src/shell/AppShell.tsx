import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useAuthStore } from '@/shared/core/authStore'
import { useSupportPermissionSync } from '@/shared/core/useSupportPermissionSync'
import { useUIStore } from '@/shared/core/uiStore'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { badgeService } from '@/shared/services/badgeService'
import { ContextPanel } from './ContextPanel'
import { NavDrawer } from './NavDrawer'
import { PageEyebrowProvider } from './PageEyebrowContext'
import { Rail } from './Rail'
import { MAIN_CONTENT_ID } from './shellIds'
import { ToolRail } from './ToolRail'
import { useShellMainBox } from './useShellMainBox'
import { ToolRailShownContext, useToolRailShown } from './toolRailShown'
import { Topbar } from './Topbar'
import { useNavDrawer } from './useNavDrawer'
import { usePanelLayout } from './usePanelLayout'
import { useShellNavigation } from './useShellNavigation'
import { useShownSection } from './useShownSection'
import { shellWhitelabelName } from './whitelabelName'
import styles from './AppShell.module.css'

export interface AppShellProps {
  /** rendered first inside <main> (VersionRefreshBanner, read-only banner) */
  banner?: ReactNode
  /** rendered after the content column, outside <main> (AiAssistantLauncher) */
  overlay?: ReactNode
  children: ReactNode
}

/**
 * The admin shell: rail and contextual panel (one drawer below 1024px), then the content column with the
 * topbar over <main id="main-content">. Every active page now uses the shared saved theme.
 */
export function AppShell({ banner, overlay, children }: AppShellProps) {
  useSupportPermissionSync()
  const { isWide, isSmallScreen } = useBreakpoint()
  const location = useLocation()
  const pathname = location.pathname

  const sections = useShellNavigation()
  const { shownKey, activeTo, showSection } = useShownSection(pathname, sections)
  const shownSection = sections.find((section) => section.key === shownKey) ?? null
  // The eyebrow is the shown section's title, unless the current page's row carries its own (a row moved
  // into another section's panel, as the Overview is in Trading).
  const activeRow = activeTo === null ? undefined : shownSection?.rows.find((row) => row.to === activeTo)
  const pageEyebrow = activeRow?.eyebrow ?? shownSection?.title ?? null

  const panelCollapsed = useUIStore((s) => s.panelCollapsed)
  const setPanelCollapsed = useUIStore((s) => s.setPanelCollapsed)
  const layout = usePanelLayout({
    navigationKey: location.key,
    isWide,
    isSmallScreen,
    panelCollapsed,
    setPanelCollapsed,
  })
  const drawer = useNavDrawer({ isDrawer: isSmallScreen, navigationKey: location.key })
  // The kit's right tool rail (player skin, from 1024px): it takes over the topbar bells and the floating
  // Assistant button, so each tool shows in one place.
  const toolRailShown = useToolRailShown()
  // Drawers open over <main> only (Drawer.module.css), as the rail's panel does.
  const mainRef = useRef<HTMLElement>(null)
  useShellMainBox(mainRef)

  // Decision 8: one query here; the rail and the panel footer read the resolved name.
  const { whitelabel } = useCurrentWhitelabel()
  const brandName = shellWhitelabelName(whitelabel)

  // Badge polling for non-agents, moved verbatim from components/Sidebar.tsx:152-161.
  const isAgent = useAuthStore((s) => s.isAgent())
  useEffect(() => {
    if (isAgent) return
    const deferred = setTimeout(() => {
      badgeService.startPolling()
    }, 500)
    return () => {
      clearTimeout(deferred)
      badgeService.stopPolling()
    }
  }, [isAgent])

  return (
    <PageEyebrowProvider value={pageEyebrow}>
      <ToolRailShownContext.Provider value={toolRailShown}>
      {/* data-shell-root: the tool panel closes on a press inside the shell, not inside a portaled layer */}
      <div className={styles.app} data-shell-root="" data-ui-radius="square">
        <NavDrawer drawer={drawer}>
          <Rail
            sections={sections}
            shownKey={shownKey}
            onSelectSection={(key) => {
              showSection(key)
              layout.revealPanel()
            }}
            brandName={brandName}
            showPanelToggle={layout.showPanelToggle}
            panelExpanded={layout.panelExpanded}
            onTogglePanel={layout.togglePanel}
          />
          <ContextPanel
            section={shownSection}
            activeTo={activeTo}
            collapsed={!layout.panelExpanded}
            onNavigate={() => drawer.setOpen(false)}
            sections={sections}
            brandName={brandName}
          />
        </NavDrawer>
        <div className={clsx(styles.content, toolRailShown && styles.withTools)} data-ui-radius="square">
          <Topbar
            showBurger={drawer.isDrawer}
            burgerRef={drawer.burgerRef}
            burgerProps={drawer.getBurgerProps()}
            onSearchOpen={() => drawer.setOpen(false)}
            bellsInToolRail={toolRailShown}
          />
          <main
            ref={mainRef}
            id={MAIN_CONTENT_ID}
            className={styles.main}
            data-ui-radius="square"
          >
            {banner}
            {children}
          </main>
          {toolRailShown && <ToolRail sections={sections} activeTo={activeTo} />}
        </div>
        {overlay}
      </div>
      </ToolRailShownContext.Provider>
    </PageEyebrowProvider>
  )
}
