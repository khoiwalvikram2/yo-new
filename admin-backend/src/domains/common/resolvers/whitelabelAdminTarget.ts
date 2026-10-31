/**
 * Pure target-selection logic for resetWhitelabelAdminPassword. Kept in its own DB-free module
 * so it can be unit-tested without bootstrapping the DB client.
 *
 * Given the whitelabel admins in a tenant and an optional adminEmail, returns the single target
 * or throws a descriptive error (no match / ambiguous match).
 */
export function selectWhitelabelAdminTarget(
  whitelabelAdmins: Array<{ id: number; email: string | null }>,
  adminEmail: string | null | undefined,
  whitelabelId: string
): { id: number; email: string | null } {
  if (adminEmail && adminEmail.trim()) {
    const email = adminEmail.trim().toLowerCase()
    const match = whitelabelAdmins.find((u) => String(u.email ?? '').trim().toLowerCase() === email)
    if (!match) {
      throw new Error(`No whitelabel admin found with email ${adminEmail} for ${whitelabelId}`)
    }
    return match
  }
  if (whitelabelAdmins.length === 0) {
    throw new Error(`No whitelabel admin found for ${whitelabelId}`)
  }
  if (whitelabelAdmins.length > 1) {
    const emails = whitelabelAdmins.map((u) => u.email ?? '(no email)').join(', ')
    throw new Error(`Multiple whitelabel admins exist (${emails}). Pass adminEmail to choose.`)
  }
  return whitelabelAdmins[0]
}
