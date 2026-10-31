import { forwardRef, type HTMLAttributes } from 'react'
import { IconUser } from '@tabler/icons-react'
import clsx from 'clsx'
import { initialsOf } from './initials'
import styles from './Avatar.module.css'

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Person or account name (ProfileMenu, T48). Initials follow spec decision 14; a blank name shows a user glyph. */
  name?: string | null
  /** The two avatar geometries in the approved UI. @default 34 */
  size?: 22 | 34
  /** Decorative colour only. `auto` assigns a stable step from the name. @default 1 */
  hue?: 1 | 2 | 3 | 4 | 5 | 'auto'
}

type ResolvedHue = Exclude<AvatarProps['hue'], 'auto' | undefined>

const HUE_CLASS: Record<ResolvedHue, string> = {
  1: styles.hue1,
  2: styles.hue2,
  3: styles.hue3,
  4: styles.hue4,
  5: styles.hue5,
}

/** The same stable 31-based hash used by the Overview player table. */
function autoHue(name: string | null | undefined): ResolvedHue {
  const key = name?.trim() ?? ''
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0
  }
  return ((hash % 5) + 1) as ResolvedHue
}

/**
 * Decorative initials circle. Always aria-hidden: the element that contains it (the ProfileMenu
 * trigger) carries the accessible name. aria-hidden is written after the spread so callers cannot un-hide it.
 */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, size = 34, hue = 1, className, ...rest },
  ref,
) {
  const initials = initialsOf(name)
  const resolvedHue = hue === 'auto' ? autoHue(name) : hue

  return (
    <span
      {...rest}
      ref={ref}
      aria-hidden="true"
      className={clsx(
        styles.avatar,
        size === 22 ? styles.size22 : styles.size34,
        HUE_CLASS[resolvedHue],
        className,
      )}
    >
      {initials || <IconUser size={size === 22 ? 14 : 17} stroke={1.75} aria-hidden="true" />}
    </span>
  )
})
