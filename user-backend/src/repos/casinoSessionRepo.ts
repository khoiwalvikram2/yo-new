import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { userCasinoSessions } from '@shared/db/schema.js'

const GAP_PROVIDER_KEY = 'gapcasino'

export type CasinoWalletType = 'cash' | 'bonus' | 'referralBonus'

export type CasinoSessionRow = typeof userCasinoSessions.$inferSelect

type Executor = typeof db

export async function createCasinoSession(
  params: {
    token: string
    userId: number
    tenant: string
    walletType: CasinoWalletType
    expiresAt: Date
    providerKey?: string
  },
  executor: Executor = db
): Promise<CasinoSessionRow> {
  const providerKey = params.providerKey ?? GAP_PROVIDER_KEY
  const [row] = await executor
    .insert(userCasinoSessions)
    .values({
      tenant: params.tenant,
      userId: params.userId,
      providerKey,
      token: params.token,
      walletType: params.walletType,
      expiresAt: params.expiresAt,
    })
    .returning()
  if (!row) {
    throw new Error('Failed to create casino session')
  }
  return row
}

export async function getCasinoSessionByToken(
  token: string,
  executor: Executor = db
): Promise<CasinoSessionRow | null> {
  return getCasinoSessionByTokenForProvider(token, GAP_PROVIDER_KEY, executor)
}

export async function getCasinoSessionByTokenForProvider(
  token: string,
  providerKey: string,
  executor: Executor = db
): Promise<CasinoSessionRow | null> {
  const rows = await executor
    .select()
    .from(userCasinoSessions)
    .where(and(eq(userCasinoSessions.providerKey, providerKey), eq(userCasinoSessions.token, token)))
    .limit(1)
  const session = rows[0] ?? null
  if (session && session.expiresAt && new Date(session.expiresAt) < new Date()) {
    return null
  }
  return session
}
