import { db } from '@/db/client.js'
import { whitelabelPaymentMethods } from '@/db/schema.js'
import { eq } from 'drizzle-orm'
import { computeOrphanedQrKeys } from './qrKeyCleanup.js'
import { validatePaymentAccountTiers } from '@shared/vip/depositAccess.js'

export type BankDetail = {
  vipTierIds?: string[] | null
  id: string
  accountName: string
  accountNumber: string
  ifsc: string
  bankName: string
  branch: string
  notes?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  weight: number
  enabled?: boolean // Whether this bank account is enabled (default: true)
}

export type UpiDetail = {
  vipTierIds?: string[] | null
  id: string
  upiId: string
  displayName?: string | null
  qrKey?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  weight: number
  enabled?: boolean // Whether this UPI account is enabled (default: true)
}

export type WhitelabelPaymentMethodsRow = {
  id: number
  tenant: string
  enabledMethods: string[]
  banks: BankDetail[]
  upis: UpiDetail[]
  limits: {
    min: number
    max: number
  }
  createdAt: Date
  updatedAt: Date
}

export type UpsertWhitelabelPaymentMethodsInput = {
  tenant: string
  enabledMethods?: string[]
  banks?: BankDetail[]
  upis?: UpiDetail[]
  limits?: {
    min: number
    max: number
  }
}

export async function getWhitelabelPaymentMethods(tenant: string): Promise<WhitelabelPaymentMethodsRow | null> {
  const [row] = await db.select()
    .from(whitelabelPaymentMethods)
    .where(eq(whitelabelPaymentMethods.tenant, tenant))
    .limit(1)
  
  if (!row) {
    return null
  }
  
  // Handle migration from old format (single bank/upi) to new format (arrays)
  let banks: BankDetail[] = []
  let upis: UpiDetail[] = []
  
  const oldBankDetails = (row.bankDetails as any)
  const oldUpiDetails = (row.upiDetails as any)
  
  // Check if it's the new format (arrays) or old format (single objects)
  if (Array.isArray(row.bankDetails)) {
    banks = ((row.bankDetails as any) || []).map((b: any) => ({
      ...b,
      enabled: b.enabled !== undefined ? b.enabled : true,
    }))
  } else if (oldBankDetails && typeof oldBankDetails === 'object') {
    // Migrate old single bank to array
    banks = [{
      id: `bank-legacy-${row.id}`,
      ...oldBankDetails,
      minAmount: null,
      maxAmount: null,
      weight: 0,
      enabled: true,
    }]
  }
  
  if (Array.isArray(row.upiDetails)) {
    upis = ((row.upiDetails as any) || []).map((u: any) => ({
      ...u,
      enabled: u.enabled !== undefined ? u.enabled : true,
    }))
  } else if (oldUpiDetails && typeof oldUpiDetails === 'object') {
    // Migrate old single UPI to array
    upis = [{
      id: `upi-legacy-${row.id}`,
      ...oldUpiDetails,
      minAmount: null,
      maxAmount: null,
      weight: 0,
      enabled: true,
    }]
  }
  
  return {
    id: row.id,
    tenant: row.tenant,
    enabledMethods: (row.enabledMethods as any) || [],
    banks,
    upis,
    limits: (row.limits as any) || { min: 100, max: 500000 },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function upsertWhitelabelPaymentMethods(
  input: UpsertWhitelabelPaymentMethodsInput
): Promise<WhitelabelPaymentMethodsRow> {
  await validatePaymentAccountTiers(db, input.tenant, [...(input.banks || []), ...(input.upis || [])])
  const existing = await getWhitelabelPaymentMethods(input.tenant)
  
  if (existing) {
    // Ensure enabled field is explicitly set for all banks and upis before saving
    const banksToSave = (input.banks !== undefined ? input.banks : existing.banks).map((b: any) => ({
      ...b,
      enabled: b.enabled !== undefined ? Boolean(b.enabled) : true, // Explicitly convert to boolean
    }))
    const upisToSave = (input.upis !== undefined ? input.upis : existing.upis).map((u: any) => ({
      ...u,
      enabled: u.enabled !== undefined ? Boolean(u.enabled) : true, // Explicitly convert to boolean
    }))
    
    // Update existing
    const [updated] = await db.update(whitelabelPaymentMethods)
      .set({
        enabledMethods: (input.enabledMethods ?? existing.enabledMethods) as any,
        bankDetails: banksToSave as any,
        upiDetails: upisToSave as any,
        limits: (input.limits ?? existing.limits) as any,
        updatedAt: new Date(),
      })
      .where(eq(whitelabelPaymentMethods.tenant, input.tenant))
      .returning()

    // Best-effort: delete QR image objects orphaned by this update — a UPI's QR was
    // replaced or removed, or the whole UPI was deleted. Inline base64 QRs have no file;
    // only stale S3 object keys are cleaned. Never blocks or fails the save.
    try {
      const orphanedQrKeys = computeOrphanedQrKeys(existing.upis, upisToSave)
      if (orphanedQrKeys.length > 0) {
        const { deleteFromS3 } = await import('@/services/storage/s3.js')
        await Promise.all(
          orphanedQrKeys.map((key) =>
            deleteFromS3(key).catch((e: any) =>
              console.warn(`[payments] failed to delete orphaned QR object ${key}:`, e?.message ?? e),
            ),
          ),
        )
      }
    } catch (e: any) {
      console.warn('[payments] QR orphan cleanup skipped:', e?.message ?? e)
    }

    // Parse the response
    let banks: BankDetail[] = []
    let upis: UpiDetail[] = []
    
    if (Array.isArray(updated.bankDetails)) {
      banks = ((updated.bankDetails as any) || []).map((b: any) => ({
        ...b,
        enabled: b.enabled !== undefined ? Boolean(b.enabled) : true,
      }))
    }
    
    if (Array.isArray(updated.upiDetails)) {
      upis = ((updated.upiDetails as any) || []).map((u: any) => ({
        ...u,
        enabled: u.enabled !== undefined ? Boolean(u.enabled) : true,
      }))
    }
    
    return {
      id: updated.id,
      tenant: updated.tenant,
      enabledMethods: (updated.enabledMethods as any) || [],
      banks,
      upis,
      limits: (updated.limits as any) || { min: 100, max: 500000 },
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }
  } else {
    // Ensure enabled field is explicitly set for all banks and upis before saving
    const banksToSave = (input.banks || []).map((b: any) => ({
      ...b,
      enabled: b.enabled !== undefined ? Boolean(b.enabled) : true, // Explicitly convert to boolean
    }))
    const upisToSave = (input.upis || []).map((u: any) => ({
      ...u,
      enabled: u.enabled !== undefined ? Boolean(u.enabled) : true, // Explicitly convert to boolean
    }))
    
    // Create new
    const [created] = await db.insert(whitelabelPaymentMethods).values({
      tenant: input.tenant,
      enabledMethods: (input.enabledMethods || []) as any,
      bankDetails: banksToSave as any,
      upiDetails: upisToSave as any,
      limits: (input.limits || { min: 100, max: 500000 }) as any,
    }).returning()
    
    const createdBanks = ((created.bankDetails as any) || []).map((b: any) => ({
      ...b,
      enabled: b.enabled !== undefined ? Boolean(b.enabled) : true,
    }))
    const createdUpis = ((created.upiDetails as any) || []).map((u: any) => ({
      ...u,
      enabled: u.enabled !== undefined ? Boolean(u.enabled) : true,
    }))
    
    return {
      id: created.id,
      tenant: created.tenant,
      enabledMethods: (created.enabledMethods as any) || [],
      banks: createdBanks,
      upis: createdUpis,
      limits: (created.limits as any) || { min: 100, max: 500000 },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    }
  }
}

