import { IconCalendar } from '@tabler/icons-react'
import { useIstClock } from './useIstClock'
import styles from './DateTime.module.css'

export function DateTime() {
  const { date, time } = useIstClock()
  return (
    <div className={styles.root}>
      <IconCalendar className={styles.icon} size={17} stroke={1.6} aria-hidden="true" />
      <span className={styles.stack}>
        <b className={styles.date}>{date}</b>
        <span className={styles.time}>{time}</span>
      </span>
    </div>
  )
}
