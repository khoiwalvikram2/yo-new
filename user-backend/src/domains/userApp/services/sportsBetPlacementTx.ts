import { and, eq, sql } from 'drizzle-orm'

const eqL = eq as any
const andL = and as any
import { sportsBets, wallets } from '@shared/db/schema.js'

const sportsBetsT = sportsBets as any
const walletsT = wallets as any
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { getWhitelabelCurrency, getCurrencySymbol } from '../../../shared/whitelabelConfig.js'
import {
  calculateProjectedExposure,
  recalculateAndUpdateExposure,
  type AdditionalLegForExposure,
} from './exposureCalculationService.js'

/** Minimal leg shape for insert + exposure (matches ValidatedLeg usage in sportsBetService). */
export type SportsPlacementValidatedLeg = {
  leg: {
    selectionId: string
    oddsSize?: number | null
    selection?: string | null
    isLive?: boolean | null
  }
  side: 'back' | 'lay'
  odds: number
  stake: number
  liability: number
  marketType: 'exchange' | 'bookmaker' | 'fancy'
  marketId: string
  eventId: string
  leagueId: string
  sportId: string
  runnerId: string
  whitelabelId: string
  currency: string
}

function toAdditionalLegs(validatedLegs: SportsPlacementValidatedLeg[]): AdditionalLegForExposure[] {
  return validatedLegs.map((leg) => ({
    marketId: leg.marketId,
    selectionId: leg.leg.selectionId,
    side: leg.side,
    price: leg.odds,
    stake: leg.stake,
    oddsSize: leg.leg.oddsSize ?? null,
  }))
}

/**
 * Cash players only: lock wallet row and ensure cash covers book-based projected exposure
 * (same logic as placeSportsBetForUser in-transaction check).
 */
export async function assertCashWalletCoversProjectedBookExposureInTx(
  tx: any,
  args: {
    walletId: number
    tenant: string
    userId: number
    validatedLegs: SportsPlacementValidatedLeg[]
  }
): Promise<void> {
  const lockResult = await tx.execute(sql`
    SELECT cash, exposure FROM wallets
    WHERE id = ${args.walletId} AND tenant = ${args.tenant}
    FOR UPDATE
    LIMIT 1
  `)
  const locked = (lockResult as any).rows?.[0] ?? (lockResult as any)[0] ?? null
  if (!locked) {
    throw new Error('Wallet not found')
  }
  const currentCash = Number(locked.cash ?? 0)
  const additionalLegs = toAdditionalLegs(args.validatedLegs)
  const projectedExposure = await calculateProjectedExposure(args.userId, args.tenant, additionalLegs)
  if (currentCash < projectedExposure) {
    const sym = getCurrencySymbol(await getWhitelabelCurrency(args.tenant))
    const currentExposure = Number(locked.exposure ?? 0)
    const available = Math.max(0, currentCash - currentExposure)
    throw new Error(
      `Insufficient available balance. Available: ${sym}${available.toFixed(2)}, Required (book-based): ${sym}${projectedExposure.toFixed(2)}`
    )
  }
}

export type PlacementTxResultRow = {
  id: string
  slipId: string
  eventId: string
  leagueId: string
  sportId: string
  marketId: string
  selectionId: string
  selection?: string | null
  side: 'back' | 'lay'
  marketType: string
  odds: number
  stake: number
  liability: number
  currency: string
  status: string
  createdAt: string
  amount: number
  type: 'back' | 'lay'
}

/**
 * Insert matched sports_bets rows, recalc exposure inside tx, optional wallet ledger line for exposure delta.
 * Shared by GraphQL placeSportsBetForUser and bet-tool (excludeFromAdminRunning).
 */
export async function insertSportsBetsAndRecalcExposureLedgerInTx(
  tx: any,
  args: {
    userId: number
    tenant: string
    wallet: { id: number }
    slipId: string
    validatedLegs: SportsPlacementValidatedLeg[]
    excludeFromAdminRunning?: boolean
    ipAddress?: string | null
    userAgent?: string | null
    deviceInfo?: string | null
    location?: string | null
    country?: string | null
  }
): Promise<PlacementTxResultRow[]> {
  const {
    userId,
    tenant,
    wallet,
    slipId,
    validatedLegs,
    excludeFromAdminRunning = false,
    ipAddress = null,
    userAgent = null,
    deviceInfo = null,
    location = null,
    country = null,
  } = args

  const inserted: Array<{ row: Record<string, unknown>; leg: SportsPlacementValidatedLeg }> = []
  for (const leg of validatedLegs) {
    const [row] = await tx
      .insert(sportsBetsT)
      .values({
        tenant,
        whitelabelId: leg.whitelabelId,
        userId,
        sportId: leg.sportId,
        leagueId: leg.leagueId,
        marketId: leg.marketId,
        eventId: leg.eventId,
        runnerId: leg.runnerId,
        selectionId: leg.leg.selectionId,
        side: leg.side,
        price: String(leg.odds),
        size: String(leg.stake),
        stake: String(leg.stake),
        liability: String(leg.liability),
        currency: leg.currency,
        status: 'matched',
        matchedAt: new Date(),
        oddsSize: leg.leg.oddsSize != null ? String(leg.leg.oddsSize) : null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        location: location || null,
        country: country || null,
        deviceInfo: deviceInfo || null,
        excludeFromAdminRunning,
      })
      .returning()
    inserted.push({ row, leg })
  }

  const [wBefore] = await tx
    .select({ cash: walletsT.cash, exposure: walletsT.exposure })
    .from(walletsT)
    .where(andL(eqL(walletsT.userId, userId), eqL(walletsT.tenant, tenant)))
    .limit(1)
  await recalculateAndUpdateExposure(userId, tenant, tx)
  const [wAfter] = await tx
    .select({ exposure: walletsT.exposure })
    .from(walletsT)
    .where(andL(eqL(walletsT.userId, userId), eqL(walletsT.tenant, tenant)))
    .limit(1)

  if (wBefore && wAfter && wallet) {
    const oldExposure = Number(wBefore.exposure ?? 0)
    const newExposure = Number(wAfter.exposure ?? 0)
    const cash = Number(wBefore.cash ?? 0)
    const delta = newExposure - oldExposure
    if (delta !== 0) {
      const firstMarketId = validatedLegs[0]?.marketId ?? ''
      const virtualBefore = cash - oldExposure
      const virtualAfter = cash - newExposure
      const sportsBetIds = inserted.map(({ row }) => String((row as { id: string }).id))
      await createWalletLedgerEntry(tx, {
        tenant,
        walletId: wallet.id,
        userId,
        walletType: 'cash',
        category: 'sports_bet',
        direction: delta > 0 ? 'debit' : 'credit',
        amount: Math.abs(delta),
        balanceBefore: virtualBefore,
        balanceAfter: virtualAfter,
        description: delta > 0 ? 'Sports bet (exposure)' : 'Sports bet (exposure reduced)',
        referenceType: 'sports_market',
        referenceId: firstMarketId,
        meta: { oldExposure, newExposure, sportsBetIds },
      })
    }
  }

  return inserted.map(({ row, leg }) => ({
    id: String((row as any).id),
    slipId,
    eventId: leg.eventId,
    leagueId: leg.leagueId,
    sportId: leg.sportId,
    marketId: leg.marketId,
    selectionId: leg.leg.selectionId,
    selection: leg.leg.selection ?? null,
    side: leg.side,
    marketType: leg.marketType,
    odds: leg.odds,
    stake: leg.stake,
    liability: leg.liability,
    currency: leg.currency,
    status: String((row as any).status ?? 'matched'),
    createdAt:
      (row as any).createdAt instanceof Date
        ? (row as any).createdAt.toISOString()
        : new Date().toISOString(),
    amount: leg.stake,
    type: leg.side,
  }))
}

/** Liability for tool/API placement (aligned with sportsBetService fancy vs exchange rules). */
export function computeSportsPlacementLiability(
  marketType: 'exchange' | 'bookmaker' | 'fancy',
  side: 'back' | 'lay',
  stake: number,
  odds: number,
  oddsSize?: number | null
): number {
  if (marketType === 'fancy' && oddsSize != null) {
    const oddsSizePercent = oddsSize / 100
    return side === 'lay' ? stake * oddsSizePercent : stake
  }
  return side === 'lay' ? Math.max((odds - 1) * stake, 0) : stake
}
