import type { ReactNode } from 'react';
import { EmptyState as KitEmptyState } from '@/ui/components/EmptyState';

interface EmptyStateProps {
  description?: string;
  image?: ReactNode;
}

export const EmptyState = ({
  description = "No data available",
  image,
}: EmptyStateProps) => {
  return (
    <KitEmptyState title={description} icon={image} />
  );
};

