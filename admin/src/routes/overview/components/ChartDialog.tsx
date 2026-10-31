/**
 * Shared expanded-chart dialog and trigger.
 *
 * The chart API stays intentionally tiny: callers mount the dialog while open and own the close
 * state. The kit Dialog now supplies the portal, themed surface, focus containment, inert page,
 * scroll lock, Escape/outside dismissal and connected-trigger focus return.
 */
import type { ReactNode } from 'react';
import { IconMaximize } from '@tabler/icons-react';
import { Dialog } from '@/ui/components/Dialog';
import { IconButton } from '@/ui/components/IconButton';

export interface ChartDialogProps {
  /** Names the dialog for assistive technology and prints in its header. */
  title: string;
  /** Called by the close control, the scrim and Escape. */
  onClose: () => void;
  /** The full-size chart. */
  children: ReactNode;
}

/** Mount to open, unmount to close. */
export function ChartDialog({ title, onClose, children }: ChartDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
      title={title}
      size="xl"
    >
      {children}
    </Dialog>
  );
}

export interface ExpandButtonProps {
  /** Names the control, e.g. "Expand Hourly Activity". */
  'aria-label': string;
  onClick: () => void;
}

/** The approved 30px bordered card-head control. */
export function ExpandButton({ 'aria-label': ariaLabel, onClick }: ExpandButtonProps) {
  return (
    <IconButton
      label={ariaLabel}
      icon={<IconMaximize size={15} stroke={1.75} />}
      variant="bordered"
      onClick={onClick}
    />
  );
}
