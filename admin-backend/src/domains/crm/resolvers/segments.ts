import {
  crmCanViewAllPlayers,
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import {
  listCrmSegments,
  createCrmSegment,
  updateCrmSegment,
  deleteCrmSegment,
} from '@src/repos/crm/CrmSegmentsRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * Saved player filters.
 *
 * The permission is `crm.players:view`, deliberately not a new one: saving a
 * filter you can already run confers nothing. Running it still resolves through
 * the reader's own books, so a segment cannot reach a player its owner could
 * not have opened by typing the same filter by hand.
 *
 * **Sharing takes `crm.players:view_all`.** A shared segment is a statement
 * about the whole whitelabel's players — "these are the people the desk is
 * chasing" — and `view_all` already means exactly "you speak for the desk
 * rather than for one book". It is not a scope control: a shared segment shows
 * each reader only their own players, which is the property that makes sharing
 * safe at all. It is an authorship control, so a single agent cannot put work
 * definitions in front of the whole whitelabel.
 */

/**
 * Timestamps arrive two ways, as they do in the task resolvers: drizzle's typed
 * selects give Date objects, while the raw SQL the segment list uses hands back
 * whatever the driver produced, which for a timestamp is a string. Assuming
 * Date threw on the first real read.
 */
const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** Segment names are shown in a picker; an unbounded one breaks the control. */
const MAX_NAME = 120
const MAX_DESCRIPTION = 500

function present(s: Awaited<ReturnType<typeof listCrmSegments>>[number], selfId: string) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    // Serialised for transport: the filter is stored as the player query's own
    // input shape and handed straight back to it, so there is nothing to map.
    filter: s.filter,
    isShared: s.isShared,
    ownerName: s.ownerName,
    isMine: s.ownerId === selfId,
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  }
}

export const crmSegmentQueries = {
  crmSegments: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    const user = requireCrmUser(ctx)
    const rows = await listCrmSegments(user.tenant, user.id)
    return rows.map((s) => present(s, user.id))
  },
}

export const crmSegmentMutations = {
  crmCreateSegment: async (
    _: unknown,
    args: { name: string; description?: string; filter?: unknown; isShared?: boolean },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const name = String(args.name ?? '').trim()
    if (!name) return { ok: false, error: 'A segment needs a name' }
    if (name.length > MAX_NAME) return { ok: false, error: `Keep the name under ${MAX_NAME} characters` }
    const description = args.description?.trim() ?? null
    if (description && description.length > MAX_DESCRIPTION) {
      return { ok: false, error: `Keep the description under ${MAX_DESCRIPTION} characters` }
    }

    const wantsShared = args.isShared === true
    if (wantsShared && !crmCanViewAllPlayers(ctx)) {
      return { ok: false, error: 'Sharing a segment with the whole desk needs the “View all players” permission' }
    }

    const res = await createCrmSegment({
      tenant: user.tenant,
      name,
      description,
      filter: args.filter ?? {},
      ownerId: user.id,
      isShared: wantsShared,
    })
    if (!res.ok) return { ok: false, error: 'You already have a segment with that name' }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'create_segment',
      resourceType: 'crm_segment',
      resourceId: res.id,
      before: { name, isShared: wantsShared },
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmUpdateSegment: async (
    _: unknown,
    args: { id: string; name?: string; description?: string; filter?: unknown; isShared?: boolean },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    if (args.name !== undefined && !String(args.name).trim()) {
      return { ok: false, error: 'A segment needs a name' }
    }
    if (args.isShared === true && !crmCanViewAllPlayers(ctx)) {
      return { ok: false, error: 'Sharing a segment with the whole desk needs the “View all players” permission' }
    }

    // Predicated on ownership inside the repository, so the same "not found" a
    // missing id gets is what someone else's segment returns.
    const res = await updateCrmSegment(
      user.tenant,
      args.id,
      user.id,
      {
        name: args.name?.trim(),
        description: args.description?.trim() ?? undefined,
        filter: args.filter,
        isShared: args.isShared,
      },
      // A shared segment outlives its author, and its ownership predicate then
      // matched nobody — it sat in everyone's picker forever. The permission
      // that gates sharing gates tidying up after a leaver.
      crmCanViewAllPlayers(ctx)
    )
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.reason === 'duplicate_name'
            ? 'You already have a segment with that name'
            : 'Segment not found',
      }
    }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'update_segment',
      resourceType: 'crm_segment',
      resourceId: args.id,
      before: null,
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmDeleteSegment: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.players', 'view')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const done = await deleteCrmSegment(user.tenant, args.id, user.id, crmCanViewAllPlayers(ctx))
    if (!done) return { ok: false, error: 'Segment not found' }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'delete_segment',
      resourceType: 'crm_segment',
      resourceId: args.id,
      before: null,
    }).catch(() => {})
    return { ok: true, error: null }
  },
}
