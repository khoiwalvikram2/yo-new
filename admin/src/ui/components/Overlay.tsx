import {
  useCallback,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
  useMergeRefs,
  useRole,
} from '@floating-ui/react'
import { getFloatingTheme } from './floating'

export type OverlayRole = 'dialog' | 'alertdialog'

export interface OverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  role?: OverlayRole
  labelledBy?: string
  describedBy?: string
  initialFocus?: MutableRefObject<HTMLElement | null>
  dismissible?: boolean
  themeFrom?: { readonly current: Element | null }
  restoreFocusTo?: { readonly current: HTMLElement | null }
  overlayClassName?: string
  className?: string
  surfaceRef?: Ref<HTMLDivElement>
  /** Marks the surface and the overlay it sits in data-ui-radius="square", so the shared radius policy leaves
   *  their corners at 0. The overlay counts too: it clips (overflow auto) and a drawer's outer corners are its corners. */
  square?: boolean
}

interface OpenSession {
  active: boolean
  opener: HTMLElement | null
  theme: 'light' | 'dark' | undefined
}

/**
 * Modal mechanics shared by Dialog and Drawer. Floating UI owns the portal,
 * ref-counted body scroll lock, modal focus containment and `inert` page
 * isolation. Presentation belongs to the composed component's CSS module.
 */
export function Overlay({
  open,
  onOpenChange,
  children,
  role = 'dialog',
  labelledBy,
  describedBy,
  initialFocus,
  dismissible = true,
  themeFrom,
  restoreFocusTo,
  overlayClassName,
  className,
  surfaceRef,
  square = false,
}: OverlayProps) {
  const sessionRef = useRef<OpenSession>({ active: false, opener: null, theme: undefined })
  const documentActiveElement = typeof document === 'undefined' ? null : document.activeElement
  const activeElement = open && !sessionRef.current.active
    ? (restoreFocusTo?.current ?? documentActiveElement)
    : sessionRef.current.opener
  const sessionOpener =
    typeof HTMLElement !== 'undefined' && activeElement instanceof HTMLElement ? activeElement : null
  const sessionTheme = sessionRef.current.active
    ? sessionRef.current.theme
    : getFloatingTheme(themeFrom?.current ?? documentActiveElement)

  const requestOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && !dismissible) return
      onOpenChange(nextOpen)
    },
    [dismissible, onOpenChange],
  )

  const { context, refs } = useFloating({
    open,
    onOpenChange: requestOpenChange,
  })
  const dismiss = useDismiss(context, {
    enabled: dismissible,
    escapeKey: dismissible,
    outsidePress: dismissible,
  })
  const floatingRole = useRole(context, { role })
  const { getFloatingProps } = useInteractions([dismiss, floatingRole])
  const mergedSurfaceRef = useMergeRefs([refs.setFloating, surfaceRef])

  useLayoutEffect(() => {
    if (!open) {
      sessionRef.current.active = false
      return
    }

    sessionRef.current = { active: true, opener: sessionOpener, theme: sessionTheme }

  }, [open, sessionOpener, sessionTheme])

  if (!open) return null

  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        className={overlayClassName}
        data-theme={sessionTheme}
        data-ui-radius={square ? 'square' : undefined}
      >
        <FloatingFocusManager
          context={context}
          modal
          outsideElementsInert
          restoreFocus
          returnFocus={sessionOpener ? {
            get current() { return sessionOpener.isConnected ? sessionOpener : null },
          } : false}
          initialFocus={initialFocus ?? 0}
        >
          <div
            {...getFloatingProps({
              ref: mergedSurfaceRef,
              className,
              tabIndex: -1,
              'aria-modal': true,
              'aria-labelledby': labelledBy,
              'aria-describedby': describedBy,
            })}
            data-ui-radius={square ? 'square' : undefined}
          >
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  )
}
