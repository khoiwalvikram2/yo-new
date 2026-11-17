// Matka, Casino and Slots marks for the phone navigation (bottom bar and menu): a pot, a chip and cherries, drawn
// like the lucide icons beside them (lucide has no matka or chip; the two shared a gamepad before 2026-11-01).
const strokeIcon = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export function MatkaIcon({ className }: { className?: string }) {
  return <svg {...strokeIcon} className={className}><path d="M8 3.5h8" /><path d="M9.5 3.5v2.8C6 7.8 4 10.6 4 13.8a8 8 0 0 0 16 0c0-3.2-2-6-5.5-7.5V3.5" /><path d="M4.6 12.2c4.5 1.8 10.3 1.8 14.8 0" /></svg>
}

export function ChipIcon({ className }: { className?: string }) {
  return <svg {...strokeIcon} className={className}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="M12 3.5v3.2M12 17.3v3.2M3.5 12h3.2M17.3 12h3.2" /></svg>
}

export function CherriesIcon({ className }: { className?: string }) {
  return <svg {...strokeIcon} className={className}><circle cx="7.5" cy="16.5" r="3.5" /><circle cx="16.5" cy="17" r="3" /><path d="M7.5 13c.8-4.2 3.6-7.6 8.5-8.8" /><path d="M16.5 14c-.6-3.6-.8-6.9-.5-9.8" /><path d="M16 4.2c2.2 0 3.8 1 4.5 2.8-2.2.4-3.8-.5-4.5-2.8z" /></svg>
}
