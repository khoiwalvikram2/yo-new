import { db } from '@/db/client.js'
import { whitelabelPaymentMethods } from '@/db/schema.js'
import { eq } from 'drizzle-orm'
import { validatePaymentAccountTiers } from '@shared/vip/depositAccess.js'
import { parseCryptoBonusPercent, parseCryptoRate } from '@shared/utils/cryptoDeposit.js'

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

/** A USDT wallet players can deposit to. `qrKey` holds a base64 data URI, like a UPI QR. */
export type CryptoDetail = {
  vipTierIds?: string[] | null
  id: string
  network: string
  walletAddress: string
  displayName?: string | null
  qrKey?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  weight: number
  enabled?: boolean // Whether this wallet is enabled (default: true)
}

export type WhitelabelPaymentMethodsRow = {
  id: number
  tenant: string
  enabledMethods: string[]
  banks: BankDetail[]
  upis: UpiDetail[]
  cryptos: CryptoDetail[]
  /** Deposit currency per 1 USDT, one rate for the whole whitelabel; null = not set */
  cryptoRate: number | null
  /** Extra % paid on an approved crypto deposit (above 0, at most 50); null = no bonus */
  cryptoBonusPercent: number | null
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
  cryptos?: CryptoDetail[]
  /** undefined keeps the stored rate; null clears it */
  cryptoRate?: number | null
  /** undefined keeps the stored bonus; null or 0 turns it off */
  cryptoBonusPercent?: number | null
  limits?: {
    min: number
    max: number
  }
}

/** Stored crypto wallets with `enabled` made explicit (default: true). */
function normalizeCryptos(raw: unknown): CryptoDetail[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c: any) => ({
    ...c,
    enabled: c.enabled !== undefined ? Boolean(c.enabled) : true,
  }))
}

/** The crypto part of a stored row, as the API returns it. */
function cryptoView(row: typeof whitelabelPaymentMethods.$inferSelect) {
  return {
    cryptos: normalizeCryptos(row.cryptoDetails),
    cryptoRate: parseCryptoRate(row.cryptoRate),
    cryptoBonusPercent: parseCryptoBonusPercent(row.cryptoBonusPercent),
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
    ...cryptoView(row),
    limits: (row.limits as any) || { min: 100, max: 500000 },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function upsertWhitelabelPaymentMethods(
  input: UpsertWhitelabelPaymentMethodsInput
): Promise<WhitelabelPaymentMethodsRow> {
  await validatePaymentAccountTiers(db, input.tenant, [...(input.banks || []), ...(input.upis || []), ...(input.cryptos || [])])
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
    // Crypto saves send only what changed: an omitted list, rate or bonus is kept as stored.
    const cryptosToSave = normalizeCryptos(input.cryptos !== undefined ? input.cryptos : existing.cryptos)
    const cryptoRateToSave = input.cryptoRate !== undefined ? input.cryptoRate : existing.cryptoRate
    const cryptoBonusToSave = input.cryptoBonusPercent !== undefined ? parseCryptoBonusPercent(input.cryptoBonusPercent) : existing.cryptoBonusPercent

    // Update existing
    const [updated] = await db.update(whitelabelPaymentMethods)
      .set({
        enabledMethods: (input.enabledMethods ?? existing.enabledMethods) as any,
        bankDetails: banksToSave as any,
        upiDetails: upisToSave as any,
        cryptoDetails: cryptosToSave as any,
        cryptoRate: cryptoRateToSave != null ? String(cryptoRateToSave) : null,
        cryptoBonusPercent: cryptoBonusToSave != null ? String(cryptoBonusToSave) : null,
        limits: (input.limits ?? existing.limits) as any,
        updatedAt: new Date(),
      })
      .where(eq(whitelabelPaymentMethods.tenant, input.tenant))
      .returning()

    // A QR is a data URI inside its entry (S3 is gone), so a replaced or removed QR, or a deleted UPI, leaves
    // nothing behind: the row above is all there is.

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
      ...cryptoView(updated),
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
      cryptoDetails: normalizeCryptos(input.cryptos) as any,
      cryptoRate: input.cryptoRate != null ? String(input.cryptoRate) : null,
      cryptoBonusPercent: parseCryptoBonusPercent(input.cryptoBonusPercent) != null ? String(parseCryptoBonusPercent(input.cryptoBonusPercent)) : null,
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
      ...cryptoView(created),
      limits: (created.limits as any) || { min: 100, max: 500000 },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    }
  }
}

