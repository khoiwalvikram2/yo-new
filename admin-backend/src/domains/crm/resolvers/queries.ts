import { CRM_PERMISSIONS } from '@src/domains/crm/permissions.js'
import {
  crmCanViewAllPlayers,
  crmPlayerScope,
  crmClientIp,
  requireCrmPermission,
  requireCrmUser,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import { getCrmSettings, countCrmSeats } from '@src/repos/crm/CrmSettingsRepo.js'
import {
  listCrmUsers,
  getCrmUserRoleIds,
} from '@src/repos/crm/CrmUsersRepo.js'
import { listCrmRoles } from '@src/repos/crm/CrmRolesRepo.js'
import { listCrmBooks, getCrmBookMembers, getBookIdsForCrmUser } from '@src/repos/crm/CrmBooksRepo.js'
import {
  listCrmPlayers,
  getCrmPlayerProfile,
  canCrmUserSeePlayer,
} from '@src/repos/crm/CrmPlayersRepo.js'
import { getCrmPlayerTimeline, type CrmTimelineSource } from '@src/repos/crm/CrmTimelineRepo.js'
import {
  listCrmLoginAttempts,
  listCrmPiiAccess,
  listCrmIpAllowlist,
  recordCrmPiiAccess,
} from '@src/repos/crm/CrmSecurityRepo.js'

const iso = (d: Date | string | null | undefined): string | null =>
  d ? (d instanceof Date ? d.toISOString() : new Date(d).toISOString()) : null

/** Fields that count as personal data, recorded whenever a player is opened. */
const PII_FIELDS = ['phone', 'email', 'name']

/**
 * The most rows one export may take.
 *
 * An export is the one operation where "all of them" is the natural request, and
 * the natural request is also the one worth bounding: this is personal data
 * leaving the building. The response says when the cap bit.
 */
const EXPORT_ROW_CAP = 200

/** Escapes one CSV cell. A player named O'Brien, Inc. must not become two columns. */
function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const crmQueries = {
  crmMe: async (_: unknown, __: unknown, ctx: CrmContext) => {
    if (!ctx?.crmUser) return null
    const user = ctx.crmUser
    const settings = await getCrmSettings(user.tenant)
    const viewAll = crmCanViewAllPlayers(ctx)
    const bookIds = await getBookIdsForCrmUser(user.tenant, user.id)
    const { getCrmUserById } = await import('@src/repos/crm/CrmUsersRepo.js')
    const row = await getCrmUserById(user.tenant, user.id)
    const { getWhitelabelById } = await import('@src/repos/common/whitelabelRepo.js')
    const wl = await getWhitelabelById(user.tenant).catch(() => null)
    return {
      id: user.id,
      name: user.name,
      // Read from the row, like the away state below. Hardcoding null here made
      // the address appear on the sign-in response and vanish on the next page
      // load, because `crmLogin` returns the real one and this did not.
      email: row?.email ?? null,
      status: user.status,
      requirePasswordReset: user.requirePasswordReset,
      tenant: user.tenant,
      whitelabelName: (wl as { name?: string } | null)?.name ?? null,
      permissions: ctx.permissions ?? [],
      bookIds,
      canViewAllPlayers: viewAll,
      sessionIdleMinutes: settings?.sessionIdleMinutes ?? 60,
      // Their own away state. Read fresh from the row rather than the token,
      // because it changes without signing in again.
      outOfOfficeUntil: iso(row?.outOfOfficeUntil),
      delegateTo: row?.delegateTo ?? null,
    }
  },

  crmPermissionCatalog: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmUser(ctx)
    return CRM_PERMISSIONS
  },

  crmUsers: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.users', 'view')
    const user = requireCrmUser(ctx)
    const rows = await listCrmUsers(user.tenant)
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        username: r.username,
        email: r.email,
        phone: r.phone,
        status: r.status,
        requirePasswordReset: r.requirePasswordReset,
        lastLoginAt: iso(r.lastLoginAt),
        lastSeenAt: iso(r.lastSeenAt),
        outOfOfficeUntil: iso(r.outOfOfficeUntil),
        delegateTo: r.delegateTo,
        createdAt: iso(r.createdAt),
        roleNames: r.roleNames,
        roleIds: await getCrmUserRoleIds(r.id),
      }))
    )
  },

  crmRoles: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.roles', 'view')
    const user = requireCrmUser(ctx)
    const roles = await listCrmRoles(user.tenant)
    const catalog = new Map(
      CRM_PERMISSIONS.flatMap((g) => g.actions.map((a) => [`${a.domain}:${a.action}`, a]))
    )
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      userCount: r.userCount,
      permissions: r.permissions
        .map((p) => catalog.get(`${p.domain}:${p.action}`))
        .filter((p): p is NonNullable<typeof p> => !!p),
    }))
  },

  crmBooks: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.books', 'view')
    const user = requireCrmUser(ctx)
    const books = await listCrmBooks(user.tenant)
    return books.map((b) => ({ ...b, createdAt: iso(b.createdAt) }))
  },

  /**
   * What is falling through on the desk right now.
   *
   * Scoped exactly like the queue it complements: their books, or the whole
   * whitelabel with crm.players:view_all, and empty rather than everything when
   * they have no books. A supervisor sees the health of what they are
   * responsible for, not of what they are not.
   */
  crmDeskHealth: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tasks', 'view')
    const user = requireCrmUser(ctx)
    const viewAll = crmCanViewAllPlayers(ctx)
    const bookIds = viewAll ? [] : await getBookIdsForCrmUser(user.tenant, user.id)
    const { getDeskHealth } = await import('@src/repos/crm/CrmDeskHealthRepo.js')
    return getDeskHealth({ tenant: user.tenant, viewAll, bookIds })
  },

  crmBookMembers: async (_: unknown, args: { bookId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.books', 'view')
    const user = requireCrmUser(ctx)
    return getCrmBookMembers(user.tenant, args.bookId)
  },

  crmPlayers: async (
    _: unknown,
    args: {
      filter?: { search?: string; status?: string; bookId?: string; assignment?: string } | null
      limit?: number
      offset?: number
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    const user = requireCrmUser(ctx)
    const scope = await crmPlayerScope(ctx)
    const page = await listCrmPlayers(scope, args.filter ?? {}, {
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    })

    // The list carries phone and email on every row unconditionally — this is
    // the default, un-searched page an agent lands on, not a search someone
    // typed — so reading it is recorded on every non-empty page, not only when
    // a search term narrows it. A search is additionally recorded as its own
    // entry: it names what was looked for, which the list read alone does not.
    if (page.items.length > 0) {
      const fingerprint = JSON.stringify(args.filter ?? {})
      recordCrmPiiAccess({
        tenant: user.tenant,
        crmUserId: user.id,
        resourceType: 'player_list',
        resourceId: `${fingerprint}#${args.offset ?? 0}`,
        action: 'view',
        fields: PII_FIELDS,
        ipAddress: crmClientIp(ctx),
      })
    }
    if (args.filter?.search?.trim()) {
      recordCrmPiiAccess({
        tenant: user.tenant,
        crmUserId: user.id,
        resourceType: 'player_search',
        resourceId: args.filter.search.trim().slice(0, 128),
        action: 'search',
        fields: PII_FIELDS,
        ipAddress: crmClientIp(ctx),
      })
    }

    // Tags and note counts in two batched queries rather than one per row.
    // A list that cannot show what a desk has recorded about a player is a list
    // people stop trusting.
    const ids = page.items.map((p) => p.id)
    const { getTagsForPlayers } = await import('@src/repos/crm/CrmTagsRepo.js')
    const { countNotesForPlayers } = await import('@src/repos/crm/CrmNotesRepo.js')
    const [tagsByPlayer, notesByPlayer] = await Promise.all([
      getTagsForPlayers(user.tenant, ids),
      countNotesForPlayers(user.tenant, ids, 'crm'),
    ])

    return {
      items: page.items.map((p) => ({
        ...p,
        createdAt: iso(p.createdAt),
        lastLoginAt: iso(p.lastLoginAt),
        tags: (tagsByPlayer.get(p.id) ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          colour: t.colour,
        })),
        noteCount: notesByPlayer.get(p.id) ?? 0,
      })),
      total: page.total,
    }
  },

  /**
   * The player list as a CSV, for the people allowed to take it off the screen.
   *
   * `crm.players:export` has been in the catalogue since the CRM shipped,
   * described as "Download player lists. Every export is recorded against this
   * user", granted to the Supervisor role — and gated nothing, because the
   * export was never built. `recordCrmPiiAccess` even carries an `export`
   * action for it. This is that promise, kept.
   *
   * A separate permission from `view` on purpose: reading a page of players on
   * screen and walking out with the whole book are different acts, and a
   * whitelabel should be able to allow the first without the second.
   *
   * Scoped identically to the list it exports — there is no way to export a
   * player you could not have opened — and capped, because an export is the one
   * operation where "everything" is the natural request.
   */
  crmExportPlayers: async (
    _: unknown,
    args: { filter?: { search?: string; status?: string; bookId?: string; assignment?: string } | null },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.players', 'export')
    const user = requireCrmUser(ctx)
    const scope = await crmPlayerScope(ctx)

    const page = await listCrmPlayers(scope, args.filter ?? {}, { limit: EXPORT_ROW_CAP, offset: 0 })

    // Recorded before the rows are handed over, and as `export` rather than
    // `view`: "who took a copy of this" is a different question from "who
    // looked at it", and only the first is answerable after the fact.
    recordCrmPiiAccess({
      tenant: user.tenant,
      crmUserId: user.id,
      resourceType: 'player_export',
      resourceId: `${JSON.stringify(args.filter ?? {})}#${page.items.length}`,
      action: 'export',
      fields: PII_FIELDS,
      ipAddress: crmClientIp(ctx),
    })

    const header = [
      'id', 'name', 'username', 'phone', 'email', 'status', 'type',
      'book', 'owner', 'cash', 'bonus', 'exposure', 'created', 'last_login',
    ]
    const rows = page.items.map((p) => [
      p.id, p.name, p.username ?? '', p.phone ?? '', p.email ?? '', p.status, p.playerType,
      p.bookName ?? '', p.ownerName ?? '', p.cash, p.bonus, p.exposure,
      p.createdAt ? new Date(p.createdAt).toISOString() : '',
      p.lastLoginAt ? new Date(p.lastLoginAt).toISOString() : '',
    ])

    return {
      filename: `players-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: rows.length,
      // True when the cap bit, so the screen can say the file is partial rather
      // than let someone believe they exported everything.
      truncated: page.total > rows.length,
      total: page.total,
      csv: [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'),
    }
  },

  crmPlayer: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.id)
    if (!Number.isFinite(playerId)) return null

    const scope = await crmPlayerScope(ctx)
    // Checked before the profile is read, not after: a player outside this
    // caller's books must be indistinguishable from one that does not exist.
    if (!(await canCrmUserSeePlayer(scope, playerId))) return null

    const profile = await getCrmPlayerProfile(user.tenant, playerId)
    if (!profile) return null

    // How often this player has been chased, and how often nobody answered.
    // The second number is the one that tells an agent to stop calling and try
    // something else.
    const { getContactSummary } = await import('@src/repos/crm/CrmContactRepo.js')
    const contact = (await getContactSummary(user.tenant, [playerId])).get(playerId) ?? {
      attempts: 0,
      unanswered: 0,
      lastAt: null,
    }

    recordCrmPiiAccess({
      tenant: user.tenant,
      crmUserId: user.id,
      resourceType: 'player',
      resourceId: String(playerId),
      action: 'view',
      fields: PII_FIELDS,
      ipAddress: crmClientIp(ctx),
    })

    return {
      ...profile,
      createdAt: iso(profile.createdAt),
      lastLoginAt: iso(profile.lastLoginAt),
      firstBetAt: iso(profile.firstBetAt),
      lastBetAt: iso(profile.lastBetAt),
      contactAttempts: contact.attempts,
      contactUnanswered: contact.unanswered,
      lastContactedAt: iso(contact.lastAt),
    }
  },

  crmPlayerTimeline: async (
    _: unknown,
    args: { playerId: string; limit?: number; cursor?: string; sources?: string[] },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) return { entries: [], nextCursor: null }

    const scope = await crmPlayerScope(ctx)
    if (!(await canCrmUserSeePlayer(scope, playerId))) return { entries: [], nextCursor: null }

    const page = await getCrmPlayerTimeline({
      tenant: user.tenant,
      playerId,
      limit: args.limit ?? 25,
      cursor: args.cursor ?? null,
      sources: (args.sources as CrmTimelineSource[] | undefined) ?? null,
    })
    return {
      entries: page.entries.map((e) => ({ ...e, occurredAt: iso(e.occurredAt) })),
      nextCursor: page.nextCursor,
    }
  },

  crmLoginAttempts: async (
    _: unknown,
    args: { limit?: number; crmUserId?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.security', 'view')
    const user = requireCrmUser(ctx)
    const rows = await listCrmLoginAttempts(user.tenant, {
      limit: args.limit ?? 100,
      crmUserId: args.crmUserId ?? null,
    })
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }))
  },

  crmPiiAccessLog: async (
    _: unknown,
    args: { limit?: number; resourceId?: string; crmUserId?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.security', 'view')
    const user = requireCrmUser(ctx)
    const rows = await listCrmPiiAccess(user.tenant, {
      limit: args.limit ?? 100,
      resourceId: args.resourceId ?? null,
      crmUserId: args.crmUserId ?? null,
    })
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }))
  },

  crmIpAllowlist: async (_: unknown, args: { crmUserId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.security', 'view')
    const user = requireCrmUser(ctx)
    const rows = await listCrmIpAllowlist(user.tenant, args.crmUserId)
    return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }))
  },

  // ---------------------------------------------------------------------------
  // Read from the admin panel, not the CRM
  // ---------------------------------------------------------------------------

  /** The caller's own whitelabel allowance, so the admin panel can show its CRM state. */
  crmWhitelabels: async (_: unknown, __: unknown, ctx: any) => {
    const roles: string[] = ctx?.user?.roles ?? []
    const isSuperAdmin = roles.some(
      (r) =>
        r === 'Super Admin' ||
        r.toLowerCase() === 'super_admin' ||
        (r.toLowerCase().includes('super') && r.toLowerCase().includes('admin'))
    )
    if (!isSuperAdmin) throw new Error('Only a Super Admin can view CRM access.')

    const { listWhitelabelsDb } = await import('@src/repos/common/whitelabelRepo.js')
    const whitelabels = await listWhitelabelsDb()
    return Promise.all(
      whitelabels.map(async (wl: any) => {
        const s = await getCrmSettings(wl.id)
        return {
          tenant: wl.id,
          name: wl.name,
          domain: wl.domain ?? null,
          enabled: s?.enabled ?? false,
          seatLimit: s?.seatLimit ?? 0,
          seatsUsed: await countCrmSeats(wl.id),
        }
      })
    )
  },
}
