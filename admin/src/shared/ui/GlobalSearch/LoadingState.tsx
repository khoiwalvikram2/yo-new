import { Spinner } from '@/ui/components/Spinner'
import styles from './GlobalSearch.module.css'
export function LoadingState() { return <div className={styles.state}><Spinner label="Searching entities" /><p>Searching entities…</p></div> }
