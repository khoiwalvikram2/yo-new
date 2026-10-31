import { db } from '@src/db/client.js'
import { crmWhitelabelSettings, crmUsers } from '@shared/db/schema.js'
import { and, eq, ne, sql } from 'drizzle-orm'

export type CrmSettings = {
  tenant: string
  enabled: boolean
  seatLimit: number
  sessionIdleMinutes: number
  enforceIpAllowlist: boolean
  updatedBy: string | null
  updatedAt: Date
}

/**
 * What a whitelabel is allowed, as decided by Super Admin.
 *
 * A tenant with no row has no CRM. That is deliberate: the absence of a
 * decision is not permission, and every caller here treats `null` as closed
 * rather than substituting a default.
 */
export async function getCrmSettings(tenant: string): Promise<CrmSettings | null> {
  const [row] = await db
    .select()
    .from(crmWhitelabelSettings)
    .where(eq(crmWhitelabelSettings.tenant, tenant))
    .limit(1)
  if (!row) return null
  return {
    tenant: row.tenant,
    enabled: row.enabled,
    seatLimit: row.seatLimit,
    sessionIdleMinutes: row.sessionIdleMinutes,
    enforceIpAllowlist: row.enforceIpAllowlist,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  }
}

export async function upsertCrmSettings(input: {
  tenant: string
  enabled: boolean
  seatLimit: number
  sessionIdleMinutes?: number
  enforceIpAllowlist?: boolean
  updatedBy?: string | null
}): Promise<CrmSettings> {
  const [row] = await db
    .insert(crmWhitelabelSettings)
    .values({
      tenant: input.tenant,
      enabled: input.enabled,
      seatLimit: input.seatLimit,
      sessionIdleMinutes: input.sessionIdleMinutes ?? 60,
      enforceIpAllowlist: input.enforceIpAllowlist ?? false,
      updatedBy: input.updatedBy ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: crmWhitelabelSettings.tenant,
      set: {
        enabled: input.enabled,
        seatLimit: input.seatLimit,
        ...(input.sessionIdleMinutes !== undefined ? { sessionIdleMinutes: input.sessionIdleMinutes } : {}),
        ...(input.enforceIpAllowlist !== undefined ? { enforceIpAllowlist: input.enforceIpAllowlist } : {}),
        updatedBy: input.updatedBy ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  return {
    tenant: row.tenant,
    enabled: row.enabled,
    seatLimit: row.seatLimit,
    sessionIdleMinutes: row.sessionIdleMinutes,
    enforceIpAllowlist: row.enforceIpAllowlist,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  }
}

// ---------------------------------------------------------------------------
// The desk calendar
// ---------------------------------------------------------------------------

/**
 * When a whitelabel's desk works.
 *
 * Read by `getDeskHours` in CrmTasksRepo, which computes every task deadline
 * against it and stops the escalation ladder outside it. It sat on the same row
 * as the Super Admin settings above but had no writer at all, so every
 * whitelabel ran on the Asia/Kolkata default whatever market it served.
 */
export type CrmDeskCalendar = {
  timezone: string
  openMinute: number
  closeMinute: number
  /** ISO weekdays, 1 = Monday. */
  days: number[]
}

/** Null when the tenant has no settings row, which means it has no CRM. */
export async function getDeskCalendar(tenant: string): Promise<CrmDeskCalendar | null> {
  const [row] = await db
    .select({
      timezone: crmWhitelabelSettings.timezone,
      openMinute: crmWhitelabelSettings.deskOpenMinute,
      closeMinute: crmWhitelabelSettings.deskCloseMinute,
      days: crmWhitelabelSettings.deskDays,
    })
    .from(crmWhitelabelSettings)
    .where(eq(crmWhitelabelSettings.tenant, tenant))
    .limit(1)
  if (!row) return null
  return {
    timezone: row.timezone,
    openMinute: row.openMinute,
    closeMinute: row.closeMinute,
    days: ((row.days as number[] | null) ?? []).map(Number),
  }
}

/**
 * Changes the calendar for a tenant that already has one.
 *
 * Updates and never inserts, unlike `upsertCrmSettings` above. A tenant with no
 * row has no CRM — every reader in this file treats that as closed rather than
 * substituting a default — so creating one here would hand a whitelabel a CRM
 * through its own settings screen. Returns false when nothing matched, which
 * the resolver reports as a refusal.
 *
 * The caller is responsible for validating the values; this stores what it is
 * given. An unvalidated timezone reaches `Intl.DateTimeFormat` inside
 * `addWorkingMinutes` and throws there instead, which is inside `createTask`.
 */
export async function updateDeskCalendar(
  tenant: string,
  calendar: CrmDeskCalendar,
  updatedBy: string | null
): Promise<boolean> {
  const rows = await db
    .update(crmWhitelabelSettings)
    .set({
      timezone: calendar.timezone,
      deskOpenMinute: calendar.openMinute,
      deskCloseMinute: calendar.closeMinute,
      deskDays: calendar.days,
      updatedBy,
      updatedAt: new Date(),
    })
    .where(eq(crmWhitelabelSettings.tenant, tenant))
    .returning({ tenant: crmWhitelabelSettings.tenant })
  return rows.length > 0
}

export type SeatClaim =
  | { ok: true; used: number; limit: number }
  | { ok: false; reason: 'crm_disabled' | 'seat_limit_reached'; used: number; limit: number }

/**
 * Claims one seat and runs `create` in the same transaction.
 *
 * The settings row is locked first, so two concurrent creates serialise on it
 * and the second sees the first one's user. Counting seats and then inserting
 * as separate statements is what lets a limit of 3 admit 5 — the same failure
 * already proven on the assistant's message allowance, fixed the same way.
 *
 * A suspended user still holds their seat: they can be restored without anyone
 * needing to free capacity first. Deleting the user is what releases it.
 */
export async function reserveCrmSeat<T>(
  tenant: string,
  create: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<{ claim: SeatClaim; result?: T }> {
  return db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(crmWhitelabelSettings)
      .where(eq(crmWhitelabelSettings.tenant, tenant))
      .for('update')
      .limit(1)

    if (!settings || !settings.enabled) {
      return { claim: { ok: false, reason: 'crm_disabled', used: 0, limit: settings?.seatLimit ?? 0 } as SeatClaim }
    }

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(crmUsers)
      .where(and(eq(crmUsers.tenant, tenant), ne(crmUsers.status, 'DELETED')))

    const used = Number(n) || 0
    if (used >= settings.seatLimit) {
      return {
        claim: { ok: false, reason: 'seat_limit_reached', used, limit: settings.seatLimit } as SeatClaim,
      }
    }

    const result = await create(tx)
    return { claim: { ok: true, used: used + 1, limit: settings.seatLimit } as SeatClaim, result }
  })
}

/** Seats in use, for display. Not a basis for admitting a create — use reserveCrmSeat. */
export async function countCrmSeats(tenant: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crmUsers)
    .where(and(eq(crmUsers.tenant, tenant), ne(crmUsers.status, 'DELETED')))
  return Number(n) || 0
}
