import type { ReactNode } from 'react'
import { FloatingFocusManager } from '@floating-ui/react'
import clsx from 'clsx'
import type { NavDrawerApi } from './useNavDrawer'
import styles from './NavDrawer.module.css'

export interface NavDrawerProps {
  drawer: NavDrawerApi
  /** <Rail/> and <ContextPanel/>. */
  children: ReactNode
}

export function NavDrawer({ drawer, children }: NavDrawerProps) {
  const { isDrawer, open, setOpen, context, drawerRef, getDrawerProps } = drawer

  return (
    <>
      {isDrawer && (
        // Sibling of the drawer, never inside it: the drawer's transform
        // would make this position:fixed element fixed to the drawer, not
        // the viewport.
        <div
          className={clsx(styles.scrim, open && styles.scrimOn)}
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      {/* Always mounted; `disabled` switches the trap on and off. The child
          keeps its position in FloatingFocusManager's fragment, so it never
          remounts. */}
      <FloatingFocusManager context={context} disabled={!open} modal initialFocus={0} returnFocus>
        <div
          ref={drawerRef}
          className={clsx(styles.nav, isDrawer && styles.drawer, open && styles.open)}
          data-ui-radius="square"
          {...getDrawerProps()}
        >
          {children}
        </div>
      </FloatingFocusManager>
    </>
  )
}
