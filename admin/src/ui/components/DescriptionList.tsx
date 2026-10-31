import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import clsx from 'clsx'
import styles from './DescriptionList.module.css'

export interface DescriptionListItem {
  /** Stable identity for a row whose order can change. Falls back to its position. */
  key?: string | number
  term: ReactNode
  value: ReactNode
  /** Uses the quieter note treatment without changing the row's semantics. */
  note?: boolean
}

export interface DescriptionListProps
  extends Omit<HTMLAttributes<HTMLDListElement>, 'children'> {
  items: readonly DescriptionListItem[]
  /** Width of the term column in pixels. @default 116 */
  labelWidth?: 96 | 116
}

export interface DescriptionListSectionProps
  extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  children?: ReactNode
}

/** A drawer/detail section marker that may also group its description list. */
export function DescriptionListSection({
  title,
  children,
  className,
  ...rest
}: DescriptionListSectionProps) {
  return (
    <section {...rest} className={clsx(styles.section, className)}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

const DescriptionListRoot = forwardRef<HTMLDListElement, DescriptionListProps>(
  function DescriptionList(
    { items, labelWidth = 116, className, ...rest },
    ref,
  ) {
    return (
      <dl
        {...rest}
        ref={ref}
        className={clsx(
          styles.list,
          labelWidth === 96 ? styles.label96 : styles.label116,
          className,
        )}
      >
        {items.map((item, index) => (
          <div className={styles.row} key={item.key ?? index}>
            <dt className={styles.term}>{item.term}</dt>
            <dd className={clsx(styles.value, item.note && styles.note)}>{item.value}</dd>
          </div>
        ))}
      </dl>
    )
  },
)

/** Semantic key/value details. Rows remain real dl/dt/dd rather than a visual grid of divs. */
export const DescriptionList = Object.assign(DescriptionListRoot, {
  Section: DescriptionListSection,
})
