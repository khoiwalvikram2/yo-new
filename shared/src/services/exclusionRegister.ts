import { createHash } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { crmExclusionRegister } from '../db/schema.js'
import { resolveDb } from '../db/registry.js'
import type { SharedDb } from '../db/registry.js'

/**
 * The register of identifiers belonging to people who excluded themselves.
 *
 * It lives in `shared` rather than beside the rest of the CRM because the only
 * place it *has* to be consulted is registration, which happens in
 * user-backend. An exclusion attached only to an account id is evaded by
 * signing up again with the same phone number, and an exclusion that can be
 * evaded in thirty seconds is not one.
 *
 * Identifiers are stored as salted hashes, so the table is not a readable list
 * of excluded people's phone numbers, and one whitelabel's register cannot be
 * tested against another's values.
 */

export type ExclusionIdentifierKind = 'phone' | 'email'

/**
 * Normalises and hashes an identifier.
 *
 * Normalisation matters more than it looks: the same person registering as
 * `+91 98765 43210`, `09876543210` and `9876543210` must produce one hash, or
 * the register only catches people who type their number identically twice.
 */
export function hashIdentifier(
  tenant: string,
  kind: ExclusionIdentifierKind,
  value: string
): string {
  const normalised =
    kind === 'phone'
      ? value.replace(/[^0-9]/g, '').replace(/^0+/, '').slice(-10)
      : value.trim().toLowerCase()
  return createHash('sha256').update(`${tenant}:${kind}:${normalised}`).digest('hex')
}

/** Whether this identifier is on the tenant's live exclusion register. */
export async function isIdentifierExcluded(
  tenant: string,
  kind: ExclusionIdentifierKind,
  value: string | null | undefined,
  tx?: SharedDb
): Promise<boolean> {
  if (!value) return false
  const db = resolveDb(tx)
  if (!db) throw new Error('exclusionRegister: no database handle registered')

  const rows = await db
    .select({ one: sql<number>`1` })
    .from(crmExclusionRegister)
    .where(
      and(
        eq(crmExclusionRegister.tenant, tenant),
        eq(crmExclusionRegister.identifierKind, kind),
        eq(crmExclusionRegister.identifierHash, hashIdentifier(tenant, kind, value)),
        isNull(crmExclusionRegister.releasedAt)
      )
    )
    .limit(1)
  return rows.length > 0
}
