import {
  crmPlayerScope,
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import { canCrmUserSeePlayer } from '@src/repos/crm/CrmPlayersRepo.js'
import {
  listCrmTags,
  countLiveCrmTags,
  createCrmTag,
  updateCrmTag,
  archiveCrmTag,
  unarchiveCrmTag,
  mergeCrmTags,
  applyTagsToPlayers,
  removeTagsFromPlayers,
  MAX_LIVE_TAGS_PER_TENANT,
} from '@src/repos/crm/CrmTagsRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * Tags are split across two permissions on purpose.
 *
 * `crm.tags:apply` is everyday work — labelling a player is what an agent does
 * all day. `crm.tags:manage` changes the vocabulary itself, which affects
 * everyone's filters and reports, and is a supervisor's decision. Giving one
 * permission both would mean every agent can rename the label a report is
 * built on.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

const HEX = /^#[0-9a-fA-F]{6}$/

function present(t: {
  id: string
  name: string
  colour: string
  description: string | null
  archivedAt: Date | null
  mergedIntoId: string | null
  createdAt: Date
  playerCount: number
}) {
  return {
    id: t.id,
    name: t.name,
    colour: t.colour,
    description: t.description,
    isArchived: t.archivedAt !== null,
    mergedIntoId: t.mergedIntoId,
    playerCount: t.playerCount,
    createdAt: iso(t.createdAt),
  }
}

export const crmTagsQueries = {
  crmTags: async (_: unknown, args: { includeArchived?: boolean }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tags', 'apply')
    const user = requireCrmUser(ctx)
    const tags = await listCrmTags(user.tenant, { includeArchived: !!args.includeArchived })
    return tags.map(present)
  },

  crmTagLimit: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tags', 'apply')
    const user = requireCrmUser(ctx)
    return { used: await countLiveCrmTags(user.tenant), limit: MAX_LIVE_TAGS_PER_TENANT }
  },
}

export const crmTagsMutations = {
  crmCreateTag: async (
    _: unknown,
    args: { name: string; colour?: string; description?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tags', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const name = String(args.name ?? '').trim()
    if (!name) return { ok: false, error: 'A tag needs a name' }
    if (args.colour && !HEX.test(args.colour)) {
      return { ok: false, error: 'Colour must be a hex value like #2563eb' }
    }

    // The cap exists so the vocabulary stays readable. A list nobody scans is
    // not a vocabulary, and archiving is the way back under it.
    if ((await countLiveCrmTags(user.tenant)) >= MAX_LIVE_TAGS_PER_TENANT) {
      return {
        ok: false,
        error: `You already have ${MAX_LIVE_TAGS_PER_TENANT} live tags. Archive some before adding more.`,
      }
    }

    const existing = await listCrmTags(user.tenant, { includeArchived: true })
    if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: 'A tag with that name already exists' }
    }

    const tag = await createCrmTag({
      tenant: user.tenant,
      name,
      colour: args.colour ?? null,
      description: args.description ?? null,
      createdBy: `crm:${user.id}`,
    })
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'create_tag',
      resourceType: 'crm_tag',
      resourceId: tag.id,
      before: { name },
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmUpdateTag: async (
    _: unknown,
    args: { id: string; name?: string; colour?: string; description?: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tags', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)
    if (args.colour && !HEX.test(args.colour)) {
      return { ok: false, error: 'Colour must be a hex value like #2563eb' }
    }
    const row = await updateCrmTag(user.tenant, args.id, {
      name: args.name,
      colour: args.colour,
      description: args.description,
    })
    if (!row) return { ok: false, error: 'Tag not found' }
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'update_tag',
      resourceType: 'crm_tag',
      resourceId: args.id,
      before: null,
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmArchiveTag: async (_: unknown, args: { id: string; archived: boolean }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tags', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)
    const done = args.archived
      ? await archiveCrmTag(user.tenant, args.id)
      : await unarchiveCrmTag(user.tenant, args.id)
    if (!done) return { ok: false, error: 'Tag not found' }
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: args.archived ? 'archive_tag' : 'unarchive_tag',
      resourceType: 'crm_tag',
      resourceId: args.id,
      before: null,
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmMergeTags: async (_: unknown, args: { fromId: string; intoId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.tags', 'manage')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)
    const res = await mergeCrmTags(user.tenant, args.fromId, args.intoId)
    if (!res.ok) {
      return {
        ok: false,
        error: res.reason === 'same_tag' ? 'A tag cannot be merged into itself' : 'Tag not found',
      }
    }
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'merge_tags',
      resourceType: 'crm_tag',
      resourceId: args.fromId,
      before: { intoId: args.intoId, moved: res.moved },
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmApplyTags: async (
    _: unknown,
    args: { playerIds: string[]; tagIds: string[] },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tags', 'apply')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const reachable = await reachablePlayers(ctx, args.playerIds)
    if (reachable.length === 0) return { ok: false, error: 'No players you can reach were selected' }

    const n = await applyTagsToPlayers({
      tenant: user.tenant,
      playerIds: reachable,
      tagIds: args.tagIds ?? [],
      taggedBy: `crm:${user.id}`,
    })
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'apply_tags',
      resourceType: 'player',
      resourceId: String(reachable.length),
      before: { tagIds: args.tagIds, applied: n },
    }).catch(() => {})
    return { ok: true, error: null }
  },

  crmRemoveTags: async (
    _: unknown,
    args: { playerIds: string[]; tagIds: string[] },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.tags', 'apply')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const reachable = await reachablePlayers(ctx, args.playerIds)
    if (reachable.length === 0) return { ok: false, error: 'No players you can reach were selected' }

    const n = await removeTagsFromPlayers({
      tenant: user.tenant,
      playerIds: reachable,
      tagIds: args.tagIds ?? [],
    })
    // Recorded like its opposite directly above. Taking a label off a player is
    // as much a change to what every filter and report is built on as putting
    // one on, and this was the only tag mutation that left no trace.
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'remove_tags',
      resourceType: 'player',
      resourceId: String(reachable.length),
      before: { tagIds: args.tagIds, removed: n },
    }).catch(() => {})
    return { ok: true, error: null }
  },
}

/**
 * Narrows a requested set of players to the ones this caller may actually
 * reach.
 *
 * Filtering rather than refusing the whole request: a supervisor bulk-tagging a
 * selection should not have the operation fail because one row has since moved
 * out of their books. What must not happen is a tag landing on a player they
 * cannot see, which is why every id is checked rather than the count.
 */
/**
 * The same ceiling `BULK_TASK_CAP` puts on the sibling bulk path.
 *
 * The visibility check below is one database round trip per id, so an
 * unbounded `playerIds` array is a request that holds a connection for as long
 * as the caller cares to make it.
 */
const BULK_TAG_CAP = 200

async function reachablePlayers(ctx: CrmContext, playerIds: string[]): Promise<number[]> {
  const ids = (playerIds ?? [])
    .map((id) => Number(id))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, BULK_TAG_CAP)
  if (ids.length === 0) return []
  const scope = await crmPlayerScope(ctx)
  const allowed: number[] = []
  for (const id of ids) {
    if (await canCrmUserSeePlayer(scope, id)) allowed.push(id)
  }
  return allowed
}
