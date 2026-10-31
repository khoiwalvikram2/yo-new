import clsx from 'clsx'
import styles from './Button.module.css'
import type { ButtonSize, ButtonVariant } from './Button'

/* A react-router <Link> that should look like a button takes these classes instead of wrapping a
   <button> in an <a>, which is invalid (interactive content inside a link) and loses middle-click and
   "open in new tab". It lives outside Button.tsx because a component file may export only components
   (react-refresh/only-export-components).

   <Link to="/overview" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>Go to home</Link> */

export interface ButtonClassNameOptions {
  /** @default 'secondary' */
  variant?: ButtonVariant
  /** @default 'md' */
  size?: ButtonSize
  /** Fill the width of the row it sits in. @default false */
  block?: boolean
  /** Appended last, so the caller can still add its own class. */
  className?: string
}

export function buttonClassName({
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
}: ButtonClassNameOptions = {}): string {
  return clsx(styles.button, styles[variant], styles[size], block && styles.block, className)
}
