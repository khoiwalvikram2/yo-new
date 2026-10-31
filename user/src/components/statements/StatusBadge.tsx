import './statements-ui.css'

type StatusValue =
  | 'Success'
  | 'Pending'
  | 'Processing'
  | 'Failed'
  | 'Win'
  | 'Lose'
  | 'Void'
  | 'Matched'
  | 'Unmatched'
  | 'Settled'
  | 'Cancelled'

export default function StatusBadge({ value }: { value: StatusValue }) {
  const color =
    value === 'Success' || value === 'Win' || value === 'Matched'
      ? 'green'
      : value === 'Pending' || value === 'Unmatched'
      ? 'yellow'
      : value === 'Processing' || value === 'Settled'
      ? 'blue'
      : value === 'Void' || value === 'Cancelled'
      ? 'gray'
      : 'red'
  const tone =
    color === 'green'
      ? 'is-success'
      : color === 'yellow'
      ? 'is-pending'
      : color === 'blue'
      ? 'is-info'
      : color === 'gray'
      ? 'is-neutral'
      : 'is-failed'
  return (
    <span className={`nova-acct-chip nova-stmt-status ${tone} tone-${color}`}>
      <span className="nova-stmt-status-dot" aria-hidden="true" />
      {value}
    </span>
  )
}

