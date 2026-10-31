import { db } from '@/db/client.js'
import { adminIpAllowlist } from '@/db/schema.js'
import { and, eq } from 'drizzle-orm'

export type IpEntry = {
  id: number
  tenant: string
  userId: number
  cidr: string
  createdAt: Date | string
}

export async function listIpAllowlist(userId: number, tenant = 'default'): Promise<IpEntry[]> {
  const rows = await db.select({
    id: adminIpAllowlist.id,
    tenant: adminIpAllowlist.tenant,
    userId: adminIpAllowlist.userId,
    cidr: adminIpAllowlist.cidr,
    createdAt: adminIpAllowlist.createdAt,
  })
    .from(adminIpAllowlist)
    .where(and(eq(adminIpAllowlist.userId, userId), eq(adminIpAllowlist.tenant, tenant)))
  
  return rows.map(r => ({
    id: r.id,
    tenant: r.tenant,
    userId: r.userId,
    cidr: r.cidr,
    createdAt: r.createdAt,
  }))
}

export async function addIpToAllowlist(userId: number, cidr: string, tenant = 'default'): Promise<number> {
  const inserted = await db.insert(adminIpAllowlist)
    .values({ userId, cidr, tenant })
    .onConflictDoNothing()
    .returning({ id: adminIpAllowlist.id })
  
  if (inserted.length === 0) {
    // Entry already exists, fetch it
    const existing = await db.select({ id: adminIpAllowlist.id })
      .from(adminIpAllowlist)
      .where(and(
        eq(adminIpAllowlist.userId, userId),
        eq(adminIpAllowlist.cidr, cidr),
        eq(adminIpAllowlist.tenant, tenant)
      ))
    return existing[0]?.id || 0
  }
  
  return inserted[0].id
}

export async function removeIpFromAllowlist(id: number, tenant = 'default'): Promise<void> {
  await db.delete(adminIpAllowlist)
    .where(and(eq(adminIpAllowlist.id, id), eq(adminIpAllowlist.tenant, tenant)))
}

export async function checkIpAllowed(userId: number, ip: string, tenant = 'default'): Promise<boolean> {
  const entries = await listIpAllowlist(userId, tenant)
  
  // If no entries, allow (default off behavior)
  if (entries.length === 0) {
    return true
  }
  
  // Check if IP matches any CIDR
  for (const entry of entries) {
    if (matchesCidr(ip, entry.cidr)) {
      return true
    }
  }
  
  return false
}

function matchesCidr(ip: string, cidr: string): boolean {
  // Handle single IP (no /)
  if (!cidr.includes('/')) {
    return ip === cidr
  }
  
  // Handle CIDR notation (simplified - for production use a proper CIDR library)
  const [network, prefixLength] = cidr.split('/')
  const prefix = parseInt(prefixLength, 10)
  
  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false
  }
  
  const ipNum = ipToNumber(ip)
  const networkNum = ipToNumber(network)
  const mask = (0xFFFFFFFF << (32 - prefix)) >>> 0
  
  return (ipNum & mask) === (networkNum & mask)
}

function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some(isNaN)) {
    return 0
  }
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
}

