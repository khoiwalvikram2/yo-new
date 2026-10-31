import { Fragment, useEffect, useRef } from 'react'
import { IconUser, IconUsers, IconWorld, IconDeviceGamepad2, IconBallFootball, IconTrophy, IconCalendarEvent, IconDiamond, IconDice5, IconShare, IconReceipt, IconGift, IconFileText, IconChevronRight } from '@tabler/icons-react'
import { StatusPill } from '@/ui/components/StatusPill'
import type { SearchResult } from '@/hooks/useGlobalSearch'
import styles from './GlobalSearch.module.css'

const icons: Record<string, typeof IconUser> = {
  player: IconUser, agent: IconUsers, whitelabel: IconWorld, casinoGame: IconDeviceGamepad2, sport: IconBallFootball, league: IconTrophy, event: IconCalendarEvent, vipMember: IconDiamond, matka: IconDice5, referralCode: IconShare, bet: IconReceipt, bonus: IconGift, page: IconFileText,
  'fa-user': IconUser, 'fa-user-tie': IconUsers, 'fa-globe': IconWorld, 'fa-gamepad': IconDeviceGamepad2, 'fa-futbol': IconBallFootball, 'fa-gem': IconDiamond, 'fa-dice-five': IconDice5, 'fa-share-nodes': IconShare, 'fa-receipt': IconReceipt, 'fa-gift': IconGift,
}
export function SearchResultIcon({ type }: { type: string }) { const Icon = icons[type] || IconFileText; return <Icon size={18} stroke={1.75} aria-hidden="true" /> }
interface SearchResultItemProps { result: SearchResult; isSelected: boolean; onClick: () => void; onParentChainClick?: (route: string) => void; id?: string }
export function SearchResultItem({ result, isSelected, onClick, onParentChainClick, id }: SearchResultItemProps) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isSelected) return
    const timer = setTimeout(() => row.current?.scrollIntoView?.({ block: 'nearest', behavior: typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 50)
    return () => clearTimeout(timer)
  }, [isSelected])
  const chain = (result.type === 'player' || result.type === 'agent') ? result.parentChain : null
  return <div ref={row} className={styles.item}>
    <button type="button" id={id} role="option" aria-selected={isSelected} onClick={onClick} className={isSelected ? styles.selectedResult : styles.result}>
      <span className={styles.typeIcon}><SearchResultIcon type={result.type} /></span>
      <span className={styles.resultCopy}><span className={styles.resultTitle}>{result.label}{result.metadata?.status && <StatusPill status={result.metadata.status}>{result.metadata.status}</StatusPill>}</span>{result.subtitle && <span className={styles.subtitle}>{result.subtitle}</span>}</span>
      <IconChevronRight size={16} aria-hidden="true" className={styles.chevron} />
    </button>
    {chain && chain.length > 0 && <div className={styles.parentChain} aria-label={'Parent chain for ' + result.label}>
      {chain.map((parent, index) => <Fragment key={parent.id}>{index > 0 && <span aria-hidden="true">→</span>}<button type="button" className={parent.levelIndex === 1 ? styles.levelOne : parent.levelIndex === 2 ? styles.levelTwo : parent.levelIndex === 3 ? styles.levelThree : styles.levelOther}
        disabled={!onParentChainClick} onClick={() => onParentChainClick?.(parent.route)}>{parent.username}</button></Fragment>)}
    </div>}
  </div>
}
