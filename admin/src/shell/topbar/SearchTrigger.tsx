import { IconSearch } from '@tabler/icons-react'
import { Kbd } from '@/ui/components/Kbd'
import styles from './SearchTrigger.module.css'

export interface SearchTriggerProps {
  onOpen: () => void
}

/** Topbar search field. A button (not an input) that opens GlobalSearch; Ctrl/Cmd+K lives in useSearchHotkey. */
export function SearchTrigger({ onOpen }: SearchTriggerProps) {
  return (
    <button
      type="button"
      aria-label="Open search"
      aria-haspopup="dialog"
      className={styles.field}
      onClick={() => onOpen()}
    >
      <span className={styles.icon} aria-hidden="true">
        <IconSearch size={16} stroke={1.75} />
      </span>
      <span className={styles.placeholder}>
        <span className={styles.placeholderLong}>Search players, transactions, or reports...</span>
        <span className={styles.placeholderShort}>Search...</span>
      </span>
      <Kbd aria-hidden="true" className={styles.kbd}>
        ⌘ K
      </Kbd>
    </button>
  )
}
