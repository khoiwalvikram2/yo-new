import { Fragment, useRef, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { tabId, tabPanelId } from './tabIds'
import styles from './SegmentedControl.module.css'
import lineStyles from './Tabs.module.css'

/* A tab strip that behaves as a tablist must: ONE tab stop for the whole strip, Arrow/Home/End moving
 * selection and focus with it, `aria-selected` rather than `aria-pressed`, and `aria-controls` only on
 * the selected tab — the other panels are not mounted.
 *
 * Every admin tab strip is the line bar of the approved profile mockups (the owner, 2026-10-29): the
 * current tab underlined in the accent (Tabs.module.css). The kit's segmented look (the mockup's .seg,
 * M:778-794, shared with SegmentedControl) stays available as variant="segmented".
 *
 * `tabId` and `tabPanelId` (./tabIds) give the page the ids to hang on its panels, so the strip and
 * the panels cannot drift apart. */

export interface TabItem<T extends string> {
  value: T
  label: string
  /** Decorative; the label carries the meaning. */
  icon?: ReactNode
  /** A count bubble after the label (kit .seg .count), e.g. pending items. The tab is named "Pending, 18". */
  count?: number
  /** Line variant only: a hairline before this tab, closing the group of tabs before it. */
  divider?: boolean
}

export interface TabsProps<T extends string> {
  value: T
  items: readonly TabItem<T>[]
  onChange: (value: T) => void
  /** Names the strip for assistive tech, e.g. "Dashboard tabs". */
  label: string
  /** Ids are `${idPrefix}-tab-${value}` and `${idPrefix}-panel-${value}`. */
  idPrefix: string
  /** @default 'md' */
  size?: 'md' | 'sm'
  /** Vertical settings navigation uses Up/Down instead of Left/Right. */
  orientation?: 'horizontal' | 'vertical'
  /** 'line' is the section bar of the approved profile mockups: a full-width bar whose current tab is
   *  underlined in the accent (a vertical strip marks it on the left), with dividers between groups.
   *  'segmented' is the kit's .seg strip.
   *  @default 'line' */
  variant?: 'segmented' | 'line'
  className?: string
}

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  label,
  idPrefix,
  size = 'md',
  orientation = 'horizontal',
  variant = 'line',
  className,
}: TabsProps<T>) {
  const line = variant === 'line'
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = items.findIndex((item) => item.value === value)
  /* A strip always needs exactly one tab stop, so a value outside the items falls to the first tab. */
  const rovingIndex = selectedIndex >= 0 ? selectedIndex : 0

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (items.length === 0) return
    let next: number
    if (event.key === (orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight')) next = (index + 1) % items.length
    else if (event.key === (orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft')) next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    onChange(items[next].value)
    buttons.current[next]?.focus()
  }

  return (
    <div
      className={clsx(line ? lineStyles.line : styles.seg, size === 'sm' && (line ? lineStyles.sm : styles.sm), className)}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
    >
      {items.map((item, index) => {
        const selected = item.value === value
        const count = item.count === undefined ? undefined : item.count.toLocaleString()
        return (
          <Fragment key={item.value}>
            {/* decorative: the tablist owns only its tabs */}
            {line && item.divider && index > 0 ? <span className={lineStyles.divider} aria-hidden="true" /> : null}
            <button
              ref={(node) => {
                buttons.current[index] = node
              }}
              type="button"
              role="tab"
              id={tabId(idPrefix, item.value)}
              className={line ? lineStyles.tab : styles.button}
              /* the label and bubble are adjacent inline spans, which would name the tab "Pending18" */
              aria-label={count === undefined ? undefined : `${item.label}, ${count}`}
              aria-selected={selected}
              aria-controls={selected ? tabPanelId(idPrefix, item.value) : undefined}
              tabIndex={index === rovingIndex ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {item.icon ? (
                <span className={line ? lineStyles.icon : styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
              {count !== undefined ? <span className={line ? lineStyles.count : styles.count}>{count}</span> : null}
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}
