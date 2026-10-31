import {
  crmClientIp,
  requireCrmPermission,
  requireCrmUser,
  requireCrmWrite,
  type CrmContext,
} from '@src/domains/crm/guards.js'
import {
  findDsarSubject,
  buildDsarExport,
  eraseDsarFreeText,
} from '@src/repos/crm/CrmDsarRepo.js'
import { recordCrmPiiAccess } from '@src/repos/crm/CrmSecurityRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * Data subject requests.
 *
 * Deliberately **tenant-scoped, not book-scoped**, unlike almost everything
 * else in the CRM. A DSAR is the whitelabel's legal duty, not a desk's
 * workflow: the person answering it must be able to reach any player of the
 * brand, including one no book holds. The narrowness comes from the
 * permissions instead — `crm.dsar` is granted to the CRM Administrator role
 * alone in the seed, and a whitelabel that wants a compliance officer makes a
 * role carrying exactly this.
 *
 * Both operations are themselves recorded: an export in the personal-data
 * access log — an answer to "who took a copy" is the first thing the next
 * request asks — and an erasure in the audit trail with its request reference.
 */

export const crmDsarQueries = {
  crmDsarExport: async (_: unknown, args: { playerId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.dsar', 'export')
    const user = requireCrmUser(ctx)

    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) throw new Error('Player not found')
    const subject = await findDsarSubject(user.tenant, playerId)
    if (!subject) throw new Error('Player not found')

    // Logged before the document is handed over, as the CSV export is.
    recordCrmPiiAccess({
      tenant: user.tenant,
      crmUserId: user.id,
      resourceType: 'player_dsar',
      resourceId: String(playerId),
      action: 'export',
      fields: ['profile', 'notes', 'contacts', 'consents', 'rg', 'tags', 'tasks', 'access_log'],
      ipAddress: crmClientIp(ctx),
    })

    const doc = await buildDsarExport(user.tenant, playerId)
    return {
      playerId: String(playerId),
      generatedAt: doc.generatedAt,
      filename: `dsar-player-${playerId}-${doc.generatedAt.slice(0, 10)}.json`,
      json: JSON.stringify(doc, null, 2),
    }
  },
}

export const crmDsarMutations = {
  crmDsarErase: async (
    _: unknown,
    args: { playerId: string; reason: string },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.dsar', 'erase')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    // The request reference is mandatory. An erasure with no paper trail is
    // indistinguishable from someone cleaning up after themselves.
    const reason = String(args.reason ?? '').trim()
    if (reason.length < 5) {
      return {
        ok: false,
        error: 'Give the request reference or reason — an erasure must say why it happened',
        notesRedacted: 0,
        contactNotesCleared: 0,
        tasksRedacted: 0,
      }
    }

    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) {
      return { ok: false, error: 'Player not found', notesRedacted: 0, contactNotesCleared: 0, tasksRedacted: 0 }
    }
    const subject = await findDsarSubject(user.tenant, playerId)
    if (!subject) {
      return { ok: false, error: 'Player not found', notesRedacted: 0, contactNotesCleared: 0, tasksRedacted: 0 }
    }

    const res = await eraseDsarFreeText(user.tenant, playerId)

    // Audited with what was removed and why — the erasure itself is the one
    // record of this player the whitelabel must be able to produce afterwards.
    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm',
      action: 'dsar_erase',
      resourceType: 'player',
      resourceId: String(playerId),
      before: { reason, ...res },
    }).catch(() => {})

    recordCrmPiiAccess({
      tenant: user.tenant,
      crmUserId: user.id,
      resourceType: 'player_dsar',
      resourceId: String(playerId),
      action: 'erase',
      fields: ['notes', 'contact_notes', 'task_text'],
      ipAddress: crmClientIp(ctx),
    })

    return { ok: true, error: null, ...res }
  },
}
