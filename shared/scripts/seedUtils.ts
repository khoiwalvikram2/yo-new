import './loadEnv.js'
import { db } from '../src/db/client.js'
import { whitelabels, roles, userRoles } from '../src/db/schema.js'
import { eq, and } from 'drizzle-orm'

/**
 * Shared utilities for seed scripts
 */
export async function checkWhitelabelExists(tenant: string): Promise<boolean> {
  const result = await db.select({ id: whitelabels.id })
    .from(whitelabels)
    .where(eq(whitelabels.id, tenant))
    .limit(1)
  return result.length > 0
}

export async function checkRoleExists(roleName: string, tenant: string): Promise<boolean> {
  const result = await db.select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.name, roleName), eq(roles.tenant, tenant)))
    .limit(1)
  return result.length > 0
}

export async function checkUserHasRole(userId: number, roleName: string, tenant: string): Promise<boolean> {
  const role = await db.select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.name, roleName), eq(roles.tenant, tenant)))
    .limit(1)
  if (role.length === 0) return false
  const userRole = await db.select({ id: userRoles.id })
    .from(userRoles)
    .where(and(
      eq(userRoles.userId, userId),
      eq(userRoles.roleId, role[0].id),
      eq(userRoles.tenant, tenant)
    ))
    .limit(1)
  return userRole.length > 0
}

export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises')
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function exitWithError(message: string): never {
  console.error(`\n❌ Error: ${message}\n`)
  process.exit(1)
}

export function logStep(step: number, total: number, message: string): void {
  console.log(`\n[${step}/${total}] ${message}...`)
}

export function logSuccess(message: string): void {
  console.log(`  ✓ ${message}`)
}

export function logSkip(message: string): void {
  console.log(`  ⏭️  ${message}`)
}
