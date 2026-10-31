import { LoadingState as KitLoadingState } from '@/ui/components/LoadingState';
import { Skeleton } from '@/ui/components/Skeleton';
import styles from './LiveStatus.module.css';

interface LoadingStateProps {
  type?: "spinner" | "skeleton";
  message?: string;
  rows?: number;
}

export const LoadingState = ({
  type = "spinner",
  message = "Loading...",
  rows = 5,
}: LoadingStateProps) => {
  if (type === "skeleton") {
    return (
      <div className={styles.skeletons} role="status" aria-busy="true" aria-label={message || 'Loading'}>
        {Array.from({ length: Number.isFinite(rows) ? Math.max(0, Math.floor(rows)) : 5 }).map((_, index) => (
          <Skeleton key={index} height={18} lines={2} />
        ))}
      </div>
    );
  }

  return (
    <KitLoadingState label={message} minHeight={192} />
  );
};

