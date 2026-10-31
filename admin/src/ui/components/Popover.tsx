import { cloneElement, useCallback, useState, type ReactNode } from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useMergeRefs,
  useRole,
  type Placement,
} from '@floating-ui/react'
import clsx from 'clsx'
import { getFloatingTheme, type FloatingTrigger } from './floating'
import styles from './Popover.module.css'

export interface PopoverRenderApi {
  close: () => void
}

export interface PopoverProps {
  /** Exactly one element that forwards its ref and spreads props (kit Button / IconButton, or a native element). */
  trigger: FloatingTrigger
  children: ReactNode | ((api: PopoverRenderApi) => ReactNode)
  /** Controlled open state. Omit for uncontrolled. With it, pass onOpenChange or nothing can change `open`. */
  open?: boolean
  /** Called on every open/close request: trigger click, Esc, outside press, focus leaving, close(). */
  onOpenChange?: (open: boolean) => void
  /** @default 'bottom-end' */
  placement?: Placement
  /** aria-label of the dialog when it has no visible heading (Filters popover, T47). */
  label?: string
  /** id of a visible heading inside the popover; wins over `label` (bells T39, wallets T41). */
  labelledBy?: string
  /** Extra class on the surface (T41). */
  className?: string
}

/**
 * Click-opened, non-modal dialog. Flips and shifts at viewport edges, closes on Esc and outside press,
 * returns focus to the trigger when it closes. Portaled to <body> with the trigger region's data-theme.
 */
export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-end',
  label,
  labelledBy,
  className,
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const { refs, floatingStyles, context } = useFloating<HTMLElement>({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  })

  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role])

  const triggerRef = useMergeRefs([refs.setReference, trigger.ref])
  const close = useCallback(() => setOpen(false), [setOpen])
  const theme = getFloatingTheme(context.elements.domReference)

  return (
    <>
      {cloneElement(trigger, getReferenceProps({ ...trigger.props, ref: triggerRef }))}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} initialFocus={0} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={clsx(styles.popover, className)}
              data-theme={theme}
              {...getFloatingProps({
                'aria-label': labelledBy ? undefined : label,
                'aria-labelledby': labelledBy,
              })}
            >
              {typeof children === 'function' ? children({ close }) : children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
