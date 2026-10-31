import { and, count, eq, gte, sql } from 'drizzle-orm'
import { db } from '@src/db/client.js'
import { aiWhitelabelSettings, aiMessages } from '@shared/db/schema.js'

/**
 * Whether a whitelabel may use the assistant, and how much of its allowance is
 * left.
 *
 * Both gates default closed. A whitelabel with no settings row has no access at
 * all — this is deliberate: every message costs money at the provider, so a
 * newly created whitelabel must not be able to spend anything until someone
 * grants it an allowance.
 */

export type LimitPeriod = 'monthly' | 'daily' | 'total'

export interface Entitlement {
  enabled: boolean
  chatLimit: number
  limitPeriod: LimitPeriod
  used: number
  remaining: number
  /** Null when allowed; otherwise the reason to show the operator. */
  blockedReason: string | null
}

/** Start of the window the allowance is counted over. */
export function periodStart(period: LimitPeriod, now = new Date()): Date | null {
  if (period === 'total') return null
  if (period === 'daily') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d
  }
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function normalisePeriod(value: string | null | undefined): LimitPeriod {
  return value === 'daily' || value === 'total' ? value : 'monthly'
}

/**
 * Counts what the whitelabel has spent.
 *
 * A "chat" is one message the operator sends, because that is what triggers a
 * request to the provider. Counting conversations instead would let a single
 * long conversation run without limit.
 */
async function countUsage(tenant: string, since: Date | null): Promise<number> {
  const conditions = [eq(aiMessages.tenant, tenant), eq(aiMessages.role, 'user')]
  if (since) conditions.push(gte(aiMessages.createdAt, since))

  const [row] = await db
    .select({ n: count() })
    .from(aiMessages)
    .where(and(...conditions))
  return Number(row?.n ?? 0)
}

export async function getEntitlement(tenant: string): Promise<Entitlement> {
  const [settings] = await db
    .select()
    .from(aiWhitelabelSettings)
    .where(eq(aiWhitelabelSettings.tenant, tenant))
    .limit(1)

  // No row means nobody has granted this whitelabel anything.
  if (!settings) {
    return {
      enabled: false,
      chatLimit: 0,
      limitPeriod: 'monthly',
      used: 0,
      remaining: 0,
      blockedReason: 'The assistant is not enabled for this whitelabel.',
    }
  }

  const limitPeriod = normalisePeriod(settings.limitPeriod)
  const chatLimit = settings.chatLimit
  const used = await countUsage(tenant, periodStart(limitPeriod))
  const remaining = Math.max(0, chatLimit - used)

  let blockedReason: string | null = null
  if (!settings.enabled) {
    blockedReason = 'The assistant is not enabled for this whitelabel.'
  } else if (chatLimit <= 0) {
    blockedReason = 'This whitelabel has no message allowance. Ask a Super Admin to set one.'
  } else if (remaining <= 0) {
    blockedReason =
      limitPeriod === 'total'
        ? `The message allowance of ${chatLimit} has been used up.`
        : `The ${limitPeriod} message allowance of ${chatLimit} has been used up.`
  }

  return { enabled: settings.enabled, chatLimit, limitPeriod, used, remaining, blockedReason }
}

/** Raised when a whitelabel tries to chat without an allowance. */
export class AiNotEntitledError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'AiNotEntitledError'
  }
}

export async function upsertSettings(params: {
  tenant: string
  enabled: boolean
  chatLimit: number
  limitPeriod: LimitPeriod
  updatedBy: string
}): Promise<void> {
  const chatLimit = Number.isFinite(params.chatLimit) ? Math.max(0, Math.floor(params.chatLimit)) : 0

  await db
    .insert(aiWhitelabelSettings)
    .values({
      tenant: params.tenant,
      enabled: params.enabled,
      chatLimit,
      limitPeriod: params.limitPeriod,
      updatedBy: params.updatedBy,
    })
    .onConflictDoUpdate({
      target: aiWhitelabelSettings.tenant,
      set: {
        enabled: params.enabled,
        chatLimit,
        limitPeriod: params.limitPeriod,
        updatedBy: params.updatedBy,
        updatedAt: new Date(),
      },
    })
}

/**
 * Claims one message against the allowance and records it, in a single
 * transaction.
 *
 * Checking and then writing as two steps lets concurrent requests all read the
 * same "used" figure and every one of them proceed: with an allowance of three,
 * five simultaneous messages were all admitted. The row lock below serialises
 * the check per whitelabel, and the message insert is the reservation — usage
 * stays derived from the transcript, so it still cannot drift.
 *
 * Returns the id of the recorded message. Throws AiNotEntitledError when there
 * is nothing left to claim.
 */
export async function reserveChatSlot(params: {
  tenant: string
  conversationId: string
  content: string
}): Promise<string> {
  return db.transaction(async (tx) => {
    // Serialise every claim for this whitelabel. Without the lock two callers
    // read the same count and both believe they are within the allowance.
    const locked = await tx.execute(
      sql`select enabled, chat_limit, limit_period from ai_whitelabel_settings
          where tenant = ${params.tenant} for update`
    )
    const row = (locked as any).rows?.[0] ?? (locked as any)[0]

    if (!row) {
      throw new AiNotEntitledError('The assistant is not enabled for this whitelabel.')
    }
    if (!row.enabled) {
      throw new AiNotEntitledError('The assistant is not enabled for this whitelabel.')
    }

    const chatLimit = Number(row.chat_limit) || 0
    if (chatLimit <= 0) {
      throw new AiNotEntitledError('This whitelabel has no message allowance. Ask a Super Admin to set one.')
    }

    const limitPeriod = normalisePeriod(row.limit_period)
    const since = periodStart(limitPeriod)

    const conditions = [eq(aiMessages.tenant, params.tenant), eq(aiMessages.role, 'user')]
    if (since) conditions.push(gte(aiMessages.createdAt, since))
    const [usage] = await tx.select({ n: count() }).from(aiMessages).where(and(...conditions))
    const used = Number(usage?.n ?? 0)

    if (used >= chatLimit) {
      throw new AiNotEntitledError(
        limitPeriod === 'total'
          ? `The message allowance of ${chatLimit} has been used up.`
          : `The ${limitPeriod} message allowance of ${chatLimit} has been used up.`
      )
    }

    const [inserted] = await tx
      .insert(aiMessages)
      .values({
        tenant: params.tenant,
        conversationId: params.conversationId,
        role: 'user',
        content: params.content,
      })
      .returning({ id: aiMessages.id })

    return inserted.id
  })
}
