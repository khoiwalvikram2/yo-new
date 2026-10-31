/**
 * Text for a count badge: null at 0 (and for negative, NaN or non-finite input), `${max}+` above max.
 * Same rule as getBadgeText() in shared/services/badgeService.ts, but for any number, not a store key.
 */
export function formatBadgeCount(count: number, max = 99): string | null {
  if (!Number.isFinite(count)) return null
  const whole = Math.floor(count)
  if (whole <= 0) return null
  return whole > max ? `${max}+` : String(whole)
}
