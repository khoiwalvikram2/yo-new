import { useCallback, useState, type KeyboardEvent } from 'react'
import {
  useDismiss,
  useFloatingRootContext,
  useInteractions,
  type FloatingRootContext,
} from '@floating-ui/react'
import { NAV_DRAWER_ID } from './shellIds'

export interface UseNavDrawerOptions {
  /** true below 1024px: pass useBreakpoint().isSmallScreen. */
  isDrawer: boolean
  /** Changes on every navigation, including a click on the current row: pass useLocation().key. */
  navigationKey: string
}

export interface BurgerProps {
  'aria-expanded': boolean
  'aria-controls': string
  onClick: () => void
}

export interface NavDrawerApi {
  isDrawer: boolean
  open: boolean
  setOpen: (open: boolean) => void
  context: FloatingRootContext
  /** Callback ref for the burger (kit IconButton must forwardRef). */
  burgerRef: (node: HTMLElement | null) => void
  /** Callback ref for the drawer wrapper that holds Rail + ContextPanel. */
  drawerRef: (node: HTMLElement | null) => void
  getBurgerProps: () => BurgerProps
  getDrawerProps: () => Record<string, unknown>
}

export function useNavDrawer({ isDrawer, navigationKey }: UseNavDrawerOptions): NavDrawerApi {
  // Open is remembered as "the navigation it was opened on". Any navigation
  // changes the key, so the drawer closes without a setState-in-effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const [burgerEl, setBurgerEl] = useState<HTMLElement | null>(null)
  const [drawerEl, setDrawerEl] = useState<HTMLElement | null>(null)

  // Leaving or re-entering drawer mode forgets the open state, so widening to
  // >=1024 and narrowing again on the same page does not re-show the drawer.
  // (React's "adjust state while rendering" pattern.)
  const [wasDrawer, setWasDrawer] = useState(isDrawer)
  if (wasDrawer !== isDrawer) {
    setWasDrawer(isDrawer)
    setOpenedAt(null)
  }

  const open = isDrawer && openedAt !== null && openedAt === navigationKey

  const setOpen = useCallback(
    (next: boolean) => setOpenedAt(next ? navigationKey : null),
    [navigationKey],
  )

  const context = useFloatingRootContext({
    open,
    onOpenChange: setOpen,
    // reference MUST be the burger: the click that opens the drawer is still
    // bubbling when useDismiss attaches its document listener, and only a
    // press on the reference is ignored by the outside-press check.
    elements: { reference: burgerEl, floating: drawerEl },
  })

  // Outside click only. Esc is handled by onKeyDown below so that an open
  // Tooltip / Popover / Menu inside the drawer consumes Esc first.
  // 'click' (not 'pointerdown') so a touch on the scrim cannot fall through
  // as a ghost click onto the page once the scrim stops catching pointers.
  const dismiss = useDismiss(context, {
    enabled: isDrawer,
    escapeKey: false,
    outsidePress: true,
    outsidePressEvent: 'click',
  })
  const { getFloatingProps } = useInteractions([dismiss])

  const onDrawerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.nativeEvent.isComposing) return
      setOpen(false)
    },
    [setOpen],
  )

  const getBurgerProps = useCallback(
    (): BurgerProps => ({
      'aria-expanded': open,
      'aria-controls': NAV_DRAWER_ID,
      onClick: () => setOpen(!open),
    }),
    [open, setOpen],
  )

  const getDrawerProps = useCallback((): Record<string, unknown> => {
    if (!isDrawer) return { id: NAV_DRAWER_ID }
    return getFloatingProps({
      id: NAV_DRAWER_ID,
      role: 'dialog',
      'aria-modal': true,
      'aria-label': 'Navigation',
      onKeyDown: onDrawerKeyDown,
    })
  }, [isDrawer, getFloatingProps, onDrawerKeyDown])

  return {
    isDrawer,
    open,
    setOpen,
    context,
    burgerRef: setBurgerEl,
    drawerRef: setDrawerEl,
    getBurgerProps,
    getDrawerProps,
  }
}
