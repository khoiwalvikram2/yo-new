import {
  cloneElement,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type Key,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import {
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListItem,
  useListNavigation,
  useMergeRefs,
  useRole,
  useTypeahead,
  type Placement,
  type UseInteractionsReturn,
} from '@floating-ui/react'
import clsx from 'clsx'
import { getFloatingTheme, type FloatingTrigger } from './floating'
import styles from './Menu.module.css'

interface MenuContextValue {
  activeIndex: number | null
  getItemProps: UseInteractionsReturn['getItemProps']
  close: () => void
  isTypingRef: MutableRefObject<boolean>
}

const MenuContext = createContext<MenuContextValue | null>(null)

export interface MenuProps {
  /** Exactly one element that forwards its ref and spreads props. */
  trigger: FloatingTrigger
  /** MenuItem / MenuSeparator / MenuLabel elements; FloatingList orders the items by DOM position. */
  children: ReactNode
  /** @default 'bottom-end' */
  placement?: Placement
}

export function Menu({ trigger, children, placement = 'bottom-end' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const elementsRef = useRef<Array<HTMLElement | null>>([])
  const labelsRef = useRef<Array<string | null>>([])
  const isTypingRef = useRef(false)

  const { refs, floatingStyles, context } = useFloating<HTMLElement>({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  })

  const click = useClick(context)
  const role = useRole(context, { role: 'menu' })
  const dismiss = useDismiss(context)
  const listNavigation = useListNavigation(context, {
    listRef: elementsRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  })
  const typeahead = useTypeahead(context, {
    listRef: labelsRef,
    activeIndex,
    onMatch: open ? setActiveIndex : undefined,
    onTypingChange: (typing) => {
      isTypingRef.current = typing
    },
  })

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    role,
    dismiss,
    listNavigation,
    typeahead,
  ])

  const close = useCallback(() => setOpen(false), [])
  const contextValue = useMemo<MenuContextValue>(
    () => ({ activeIndex, getItemProps, close, isTypingRef }),
    [activeIndex, getItemProps, close],
  )

  const triggerRef = useMergeRefs([refs.setReference, trigger.ref])
  const theme = getFloatingTheme(context.elements.domReference)

  return (
    <>
      {cloneElement(trigger, getReferenceProps({ ...trigger.props, ref: triggerRef }))}
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false} returnFocus>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className={styles.menu}
              data-theme={theme}
              {...getFloatingProps()}
            >
              <FloatingList elementsRef={elementsRef} labelsRef={labelsRef}>
                <MenuContext.Provider value={contextValue}>{children}</MenuContext.Provider>
              </FloatingList>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}

export interface MenuItemProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'role' | 'onSelect'> {
  /** Leading icon, e.g. <IconKey size={15} stroke={1.75} aria-hidden />. */
  icon?: ReactNode
  /** Runs after the menu closes. */
  onSelect?: () => void
  /** Adds the matching composite-widget role. Omit for a plain menu item. */
  type?: MenuItemType
  /** Selection state for radio and checkbox items. Ignored by plain menu items. */
  checked?: boolean
  /** @default 'default' */
  tone?: MenuItemTone
}

export type MenuItemType = 'radio' | 'checkbox'
export type MenuItemTone = 'default' | 'danger'

/** DataTable and other collection components can describe a row menu without owning Menu's DOM. */
export interface MenuItemSpec {
  key: Key
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  type?: MenuItemType
  checked?: boolean
  tone?: MenuItemTone
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  {
    icon,
    onSelect,
    type,
    checked = false,
    tone = 'default',
    disabled,
    children,
    className,
    onClick,
    onKeyDown,
    ...rest
  },
  forwardedRef,
) {
  const menu = useContext(MenuContext)
  // label null → skipped by typeahead; undefined → the button's textContent is used.
  const item = useListItem({ label: disabled ? null : undefined })
  const ref = useMergeRefs([item.ref, forwardedRef])

  if (!menu) throw new Error('<MenuItem> must be rendered inside <Menu>.')
  const isActive = item.index === menu.activeIndex
  const role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox' = type ? `menuitem${type}` : 'menuitem'

  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      role={role}
      aria-checked={type ? checked : undefined}
      disabled={disabled}
      tabIndex={isActive ? 0 : -1}
      className={clsx(styles.item, tone === 'danger' && styles.danger, className)}
      {...menu.getItemProps({
        active: isActive,
        onClick(event) {
          onClick?.(event as MouseEvent<HTMLButtonElement>)
          if (disabled || event.defaultPrevented) return
          menu.close()
          onSelect?.()
        },
        onKeyDown(event) {
          onKeyDown?.(event as KeyboardEvent<HTMLButtonElement>)
          // While the user is typing for typeahead, Space is a character, not a click.
          if (event.key === ' ' && menu.isTypingRef.current) event.preventDefault()
        },
      })}
    >
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {type ? (
        <span className={styles.check} aria-hidden="true">
          {checked ? '✓' : null}
        </span>
      ) : null}
    </button>
  )
})

export function MenuSeparator() {
  return <div role="separator" className={styles.separator} />
}

/**
 * A group heading (kit .menu__label), e.g. "Export as". It never registers with FloatingList, so arrow
 * keys and typeahead pass over it; role="presentation" keeps it out of the menu's item structure, and
 * the items under it still carry their own names.
 */
export function MenuLabel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} role="presentation" className={clsx(styles.groupLabel, className)} />
}
