import { IconFlag } from '@tabler/icons-react';
import { Tooltip } from '@/ui/components/Tooltip';
import { strokeFor } from '@/ui/components/icons';
import styles from './PlayerSignals.module.css';

interface PlayerFlagIndicatorProps {
  flags: string[];
  userId: string;
}

export function PlayerFlagIndicator({ flags }: PlayerFlagIndicatorProps) {
  if (!flags || flags.length === 0) {
    return null;
  }

  return (
    <Tooltip
      content={
        <div className={styles.tooltip}>
          <strong>Active Flags:</strong>
          <div className={styles.tooltip}>
            {flags.map((flag, idx) => (
              <span key={idx}>
                • {flag}
              </span>
            ))}
          </div>
        </div>
      }
      placement="top"
    >
      <span className={styles.flag} tabIndex={0} aria-label={`Active Flags: ${flags.join(', ')}`}><IconFlag size={14} stroke={strokeFor(14)} aria-hidden="true" /></span>
    </Tooltip>
  );
}

