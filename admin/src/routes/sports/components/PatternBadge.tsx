import { IconBolt, IconUsers, IconSitemap, IconCurrencyDollar, IconClock, IconHeartHandshake, IconChartLine } from '@tabler/icons-react';
import { Tooltip } from '@/ui/components/Tooltip';
import { Button } from '@/ui/components/Button';
import { StatusPill } from '@/ui/components/StatusPill';
import { strokeFor } from '@/ui/components/icons';
import styles from './PlayerSignals.module.css';

export type BettingPatternType = 
  | 'RAPID_BETTING'
  | 'MULTI_ACCOUNT'
  | 'COORDINATED'
  | 'UNUSUAL_STAKE'
  | 'ODD_TIMING'
  | 'AGENT_COLLUSION'
  | 'HIGH_ODDS'

export type PatternSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

interface PatternBadgeProps {
  patternType: BettingPatternType
  severity: PatternSeverity
  metrics?: Record<string, unknown>
  onClick?: () => void
}

const patternIcons = { RAPID_BETTING: IconBolt, MULTI_ACCOUNT: IconUsers, COORDINATED: IconSitemap, UNUSUAL_STAKE: IconCurrencyDollar, ODD_TIMING: IconClock, AGENT_COLLUSION: IconHeartHandshake, HIGH_ODDS: IconChartLine };
export function PatternBadge({
  patternType,
  severity,
  metrics,
  onClick,
}: PatternBadgeProps) {
  const Icon = patternIcons[patternType] || IconBolt;
  const tone = severity === 'LOW' ? 'info' : severity === 'MEDIUM' ? 'warn' : 'neg';
  const label = `${patternType.replace(/_/g, ' ')} (${severity})`;
  
  const tooltipContent = (
    <div className={styles.tooltip}>
      <strong>{patternType.replace(/_/g, ' ')}</strong>
      <span>Severity: {severity}</span>
      {metrics && Object.keys(metrics).length > 0 && (
        <div className={styles.tooltip}>
          {Object.entries(metrics).map(([key, value]) => (
            <span key={key}>
              {key}: {typeof value === 'number' ? value.toLocaleString() : String(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  )

  const content = <><Icon size={14} stroke={strokeFor(14)} aria-hidden="true" /><StatusPill tone={tone}>{severity}</StatusPill></>;
  return <Tooltip content={tooltipContent} placement="top">{onClick ? <Button size="sm" aria-label={label} onClick={onClick}>{content}</Button> : <span className={styles.pattern} tabIndex={0} aria-label={label}>{content}</span>}</Tooltip>;
}

