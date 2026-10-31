import { cloneElement, useRef, useState, type ReactNode } from 'react'
import {
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStatus,
  type Placement,
} from '@floating-ui/react'
import { getFloatingTheme, type FloatingTrigger } from './floating'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** Tooltip text. */
  content: ReactNode
  /** Exactly one element that forwards its ref and spreads props. */
  children: FloatingTrigger
  /** @default 'top' */
  placement?: Placement
  /** Hover open delay in ms. Keyboard focus opens at once (deviation D6, contracts §16). @default 350 */
  openDelay?: number
}

export function Tooltip({ content, children, placement = 'top', openDelay = 350 }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const arrowRef = useRef<HTMLSpanElement>(null)

  /* offset 8 = the 5px arrow plus the kit's 3px gap (its .tip-pop sits 8px off the trigger). The arrow's
     8px padding keeps it off the bubble's rounded corners when shift() slides the bubble along. */
  const { refs, floatingStyles, context, placement: resolved, middlewareData } = useFloating<HTMLElement>({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowRef, padding: 8 })],
  })

  const hover = useHover(context, { move: false, delay: { open: openDelay, close: 0 } })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  const { isMounted, status } = useTransitionStatus(context, { duration: 180 })

  const triggerRef = useMergeRefs([refs.setReference, children.ref])
  const theme = getFloatingTheme(context.elements.domReference)
  /* The side flip() settled on, not the one asked for: the arrow is drawn on the edge facing the trigger. */
  const side = resolved.split('-')[0]
  const arrowX = middlewareData.arrow?.x
  const arrowY = middlewareData.arrow?.y

  return (
    <>
      {cloneElement(children, getReferenceProps({ ...children.props, ref: triggerRef }))}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={styles.positioner}
            data-theme={theme}
            {...getFloatingProps()}
          >
            <div className={styles.tooltip} data-status={status} data-placement={side}>
              {content}
              <span
                ref={arrowRef}
                className={styles.arrow}
                style={{ left: arrowX ?? '', top: arrowY ?? '' }}
                aria-hidden="true"
              />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
