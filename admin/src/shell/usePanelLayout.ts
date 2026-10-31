/**
 * Panel collapse state across the three viewports (decision 11, S "Responsive", contracts §9.3).
 * panelCollapsed (uiStore, persisted) is read and written only at >= 1280px; midOpen is local and used only
 * at 1024-1279px; inside the drawer (< 1024px) the panel is always expanded and nothing is written.
 */
import { useCallback, useState } from 'react'

export type ShellViewport = 'wide' | 'mid' | 'drawer'

export interface UsePanelLayoutOptions {
  /** location.key — the same value useNavDrawer keys on (deviation D5, §16) */
  navigationKey: string
  isWide: boolean
  isSmallScreen: boolean
  /** uiStore value */
  panelCollapsed: boolean
  /** uiStore action */
  setPanelCollapsed: (collapsed: boolean) => void
}

export interface PanelLayout {
  /** isWide ? 'wide' : isSmallScreen ? 'drawer' : 'mid' */
  viewport: ShellViewport
  /** wide: !panelCollapsed; mid: midOpen; drawer: true */
  panelExpanded: boolean
  /** viewport !== 'drawer' */
  showPanelToggle: boolean
  /** chevron. wide: setPanelCollapsed(!panelCollapsed); mid: midOpen = !midOpen; drawer: nothing */
  togglePanel: () => void
  /** rail click. wide and collapsed: setPanelCollapsed(false); mid: midOpen = true; drawer: nothing */
  revealPanel: () => void
}

interface SeenInputs {
  viewport: ShellViewport
  navigationKey: string
}

export function usePanelLayout({
  navigationKey,
  isWide,
  isSmallScreen,
  panelCollapsed,
  setPanelCollapsed,
}: UsePanelLayoutOptions): PanelLayout {
  const viewport: ShellViewport = isWide ? 'wide' : isSmallScreen ? 'drawer' : 'mid'
  const [midOpen, setMidOpen] = useState(false)

  // Adjusted during render (the useNavDrawer wasDrawer pattern): crossing into mid, or any navigation while
  // in mid (a new location.key, including a same-path click), collapses the panel in the same commit.
  // The first render only records the inputs, so a deep link at mid width is not handled twice.
  const [seen, setSeen] = useState<SeenInputs>({ viewport, navigationKey })
  if (seen.viewport !== viewport || seen.navigationKey !== navigationKey) {
    setSeen({ viewport, navigationKey })
    if (viewport === 'mid') setMidOpen(false)
  }

  const togglePanel = useCallback(() => {
    if (viewport === 'wide') {
      setPanelCollapsed(!panelCollapsed)
    } else if (viewport === 'mid') {
      setMidOpen((open) => !open)
    }
  }, [viewport, panelCollapsed, setPanelCollapsed])

  const revealPanel = useCallback(() => {
    if (viewport === 'wide') {
      // The user asked to see the panel, so the persisted choice changes too.
      if (panelCollapsed) setPanelCollapsed(false)
    } else if (viewport === 'mid') {
      setMidOpen(true)
    }
  }, [viewport, panelCollapsed, setPanelCollapsed])

  const panelExpanded = viewport === 'wide' ? !panelCollapsed : viewport === 'mid' ? midOpen : true

  return {
    viewport,
    panelExpanded,
    showPanelToggle: viewport !== 'drawer',
    togglePanel,
    revealPanel,
  }
}
