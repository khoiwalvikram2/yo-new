/**
 * Users table stores lowercase status (`active` / `inactive` / `suspended`).
 * Agents commonly use uppercase `ACTIVE`. Compare case-insensitively for guards.
 */
export function isActiveEntityStatus(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'active'
}
