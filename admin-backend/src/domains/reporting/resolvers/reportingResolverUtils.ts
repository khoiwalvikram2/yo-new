/**
 * Normalize createdBy to integer for reporting tables.
 * DB column created_by is integer; JWT sub / user.id may be string or UUID.
 */
export function normalizeCreatedByForReporting(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
  throw new Error('Invalid user ID format');
}
