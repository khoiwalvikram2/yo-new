import {
  crmClientIp,
  crmPlayerScope,
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import { canCrmUserSeePlayer } from '@src/repos/crm/CrmPlayersRepo.js'
import { recordCrmPiiAccess } from '@src/repos/crm/CrmSecurityRepo.js'
import {
  listPlayerNotes,
  createPlayerNote,
  setNotePinned,
  deletePlayerNote,
  getNoteForCheck,
  type CrmNote,
} from '@src/repos/crm/CrmNotesRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * The CRM's half of notes.
 *
 * The admin panel has its own resolvers over the same store, deliberately not
 * shared with these. The two applications answer "may this caller see this
 * player" differently — the CRM through book membership, the admin panel
 * through its own permissions — and one resolver serving both would have to
 * guess which caller it had. The shared code sits in the repository, below both
 * checks.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

function present(n: CrmNote) {
  return {
    id: n.id,
    content: n.body,
    category: n.category,
    labels: n.labels,
    isPinned: n.isPinned,
    visibility: n.visibility,
    authorKind: n.authorKind,
    createdBy: n.authorName,
    createdAt: iso(n.createdAt),
    // Notes cannot be edited in Phase 2, so this is null rather than a lie that
    // an edit happened at creation time.
    updatedAt: null,
  }
}

/** Refuses a player this caller may not reach, before any note is read. */
async function assertPlayerReachable(ctx: CrmContext, playerId: number): Promise<boolean> {
  const scope = await crmPlayerScope(ctx)
  return canCrmUserSeePlayer(scope, playerId)
}

export const crmNotesQueries = {
  crmPlayerNotes: async (_: unknown, args: { playerId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.notes', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) return []

    // Scope first. A player outside this caller's books must be
    // indistinguishable from one with no notes.
    if (!(await assertPlayerReachable(ctx, playerId))) return []

    const notes = await listPlayerNotes(user.tenant, playerId, 'crm')

    // Notes are the most sensitive free text about a player, so reading them is
    // recorded the same way opening their profile is.
    recordCrmPiiAccess({
      tenant: user.tenant,
      crmUserId: user.id,
      resourceType: 'player_notes',
      resourceId: String(playerId),
      action: 'view',
      fields: ['notes'],
      ipAddress: crmClientIp(ctx),
    })

    return notes.map(present)
  },
}

export const crmNotesMutations = {
  crmAddPlayerNote: async (
    _: unknown,
    args: {
      input: {
        playerId: string
        content: string
        category?: string | null
        labels?: string[] | null
        isPinned?: boolean | null
        visibility?: string | null
      }
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.notes', 'create')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)
    const playerId = Number(args.input.playerId)

    if (!Number.isFinite(playerId)) return { ok: false, error: 'Unknown player', note: null }
    const body = String(args.input.content ?? '').trim()
    if (!body) return { ok: false, error: 'A note cannot be empty', note: null }

    if (!(await assertPlayerReachable(ctx, playerId))) {
      return { ok: false, error: 'That player is not in your books', note: null }
    }

    const visibility = args.input.visibility ?? 'all'
    if (!['all', 'crm_only', 'admin_only'].includes(visibility)) {
      return { ok: false, error: 'Unknown visibility', note: null }
    }

    const note = await createPlayerNote({
      tenant: user.tenant,
      playerId,
      body,
      category: args.input.category ?? null,
      labels: args.input.labels ?? [],
      isPinned: args.input.isPinned ?? false,
      visibility,
      author: { kind: 'crm', crmUserId: user.id, name: user.name },
    })

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'add_player_note',
      resourceType: 'player',
      resourceId: String(playerId),
      before: { noteId: note.id, visibility },
    }).catch(() => {})

    return { ok: true, error: null, note: present(note) }
  },

  crmSetNotePinned: async (
    _: unknown,
    args: { id: string; isPinned: boolean },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.notes', 'create')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    // Reachability is checked before the write, not after. A note id survives
    // its player moving to another book or the caller leaving one, and the
    // write used to happen first — reordering pinned notes on a desk the
    // caller no longer has scope over, with the check only deciding what the
    // response said afterward.
    const existing = await getNoteForCheck(user.tenant, args.id, 'crm')
    if (!existing || !(await assertPlayerReachable(ctx, existing.playerId))) {
      return { ok: false, error: 'Note not found' }
    }

    const note = await setNotePinned(user.tenant, args.id, !!args.isPinned, 'crm')
    if (!note) return { ok: false, error: 'Note not found' }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'set_note_pinned',
      resourceType: 'crm_player_note',
      resourceId: args.id,
      before: { isPinned: args.isPinned },
    }).catch(() => {})

    return { ok: true, error: null }
  },

  crmDeletePlayerNote: async (_: unknown, args: { id: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.notes', 'delete')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    // The one gate this mutation had none of before: an id from a period of
    // legitimate access, replayed after the player moved out of the caller's
    // scope, used to soft-delete the note anyway.
    const existing = await getNoteForCheck(user.tenant, args.id, 'crm')
    if (!existing || !(await assertPlayerReachable(ctx, existing.playerId))) {
      return { ok: false, error: 'Note not found' }
    }

    const done = await deletePlayerNote(user.tenant, args.id, `crm:${user.id}`, 'crm')
    if (!done) return { ok: false, error: 'Note not found' }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'delete_player_note',
      resourceType: 'crm_player_note',
      resourceId: args.id,
      before: null,
    }).catch(() => {})

    return { ok: true, error: null }
  },
}
