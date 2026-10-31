/**
 * The one rule about CRM passwords.
 *
 * Extracted from `crm/resolvers/mutations.ts` when the admin panel gained its
 * own CRM user management: two surfaces now set CRM passwords, and a policy
 * copied into the second one is a policy that drifts from the first. A password
 * the CRM refuses must be refused by the admin panel too, and the only way to
 * be sure of that is for both to call the same function.
 */

/** Long enough to be worth having, short enough not to be theatre. */
export const MIN_CRM_PASSWORD_LENGTH = 10

/** Returns the reason a password is unacceptable, or null when it is fine. */
export function checkCrmPassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_CRM_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_CRM_PASSWORD_LENGTH} characters`
  }
  return null
}
