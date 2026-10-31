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
  raiseRgFlag,
  liftRgFlag,
  listPlayerRgFlags,
  isBlockingFlag,
  type RgFlagType,
} from '@src/repos/crm/CrmRgRepo.js'
import {
  recordConsent,
  getPlayerConsents,
  getPlayerConsentHistory,
  type ConsentChannel,
  type ConsentPurpose,
  type ConsentState,
} from '@src/repos/crm/CrmConsentRepo.js'
import { recordAuditDb } from '@src/repos/audit/auditRepo.js'

/**
 * Responsible gambling and consent share a file because they share a rule: the
 * dangerous direction is the permissive one.
 *
 * Raising a flag and withdrawing consent are always allowed to the people who
 * do the work. Lifting a flag and restoring consent are separate permissions,
 * because those are the acts that let a player be reached again.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

const FLAG_TYPES: RgFlagType[] = [
  'SELF_EXCLUSION',
  'COOLING_OFF',
  'DEPOSIT_ESCALATION',
  'LOSS_CHASING',
  'SESSION_LENGTH',
  'AFFORDABILITY_CONCERN',
]
const CHANNELS: ConsentChannel[] = ['SMS', 'WHATSAPP', 'EMAIL', 'PUSH', 'CALL']
const PURPOSES: ConsentPurpose[] = ['MARKETING', 'SERVICE']

/**
 * How long a self-exclusion must stand before it can be lifted, when the caller
 * does not name a term. Six months is the shortest period most regulators
 * recognise as a self-exclusion rather than a break.
 */
const DEFAULT_SELF_EXCLUSION_MONTHS = 6

/**
 * The longest term the form will accept. Not a regulatory figure — an upper
 * bound so that "permanent" is expressed by a self-exclusion with no lift
 * rather than by a number nobody meant to type.
 */
const MAX_SELF_EXCLUSION_MONTHS = 120

async function reachable(ctx: CrmContext, playerId: number): Promise<boolean> {
  const scope = await crmPlayerScope(ctx)
  return canCrmUserSeePlayer(scope, playerId)
}

export const crmRgQueries = {
  crmPlayerRgFlags: async (_: unknown, args: { playerId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.rg', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId) || !(await reachable(ctx, playerId))) return []

    recordCrmPiiAccess({
      tenant: user.tenant,
      crmUserId: user.id,
      resourceType: 'player_rg',
      resourceId: String(playerId),
      action: 'view',
      fields: ['rg_flags'],
      ipAddress: crmClientIp(ctx),
    })

    const flags = await listPlayerRgFlags(user.tenant, playerId)
    return flags.map((f) => ({
      id: f.id,
      flagType: f.flagType,
      status: f.status,
      initiatedBy: f.initiatedBy,
      blocksPlay: f.blocksPlay,
      startsAt: iso(f.startsAt),
      minTermEndsAt: iso(f.minTermEndsAt),
      endsAt: iso(f.endsAt),
      balanceAtBlock: f.balanceAtBlock,
      reason: f.reason,
      raisedBy: f.raisedBy,
      raisedAt: iso(f.raisedAt),
      liftedBy: f.liftedBy,
      liftedAt: iso(f.liftedAt),
      liftReason: f.liftReason,
    }))
  },

  crmRgFlagTypes: async (_: unknown, __: unknown, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.rg', 'view')
    return FLAG_TYPES.map((t) => ({ value: t, blocksPlay: isBlockingFlag(t) }))
  },

  crmPlayerConsents: async (_: unknown, args: { playerId: string }, ctx: CrmContext) => {
    requireCrmPermission(ctx, 'crm.consent', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId) || !(await reachable(ctx, playerId))) return []

    const rows = await getPlayerConsents(user.tenant, playerId)
    return rows.map((r) => ({
      channel: r.channel,
      purpose: r.purpose,
      state: r.state,
      stateSince: iso(r.stateSince),
      grantedAt: iso(r.grantedAt),
      source: r.source,
      consentTextVersion: r.consentTextVersion,
      evidenceRef: r.evidenceRef,
    }))
  },

  crmPlayerConsentHistory: async (
    _: unknown,
    args: { playerId: string; limit?: number },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.consent', 'view')
    const user = requireCrmUser(ctx)
    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId) || !(await reachable(ctx, playerId))) return []

    const rows = await getPlayerConsentHistory(user.tenant, playerId, args.limit ?? 100)
    return rows.map((e) => ({
      id: e.id,
      channel: e.channel,
      purpose: e.purpose,
      fromState: e.fromState,
      toState: e.toState,
      source: e.source,
      evidenceRef: e.evidenceRef,
      actorKind: e.actorKind,
      actorId: e.actorId,
      reason: e.reason,
      createdAt: iso(e.createdAt),
    }))
  },
}

export const crmRgMutations = {
  crmRaiseRgFlag: async (
    _: unknown,
    args: {
      playerId: string
      flagType: string
      initiatedBy: string
      reason?: string
      endsAt?: string
      minTermMonths?: number
    },
    ctx: CrmContext
  ) => {
    requireCrmPermission(ctx, 'crm.rg', 'flag')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) return { ok: false, error: 'Unknown player' }
    if (!FLAG_TYPES.includes(args.flagType as RgFlagType)) {
      return { ok: false, error: 'Unknown flag type' }
    }
    if (!['player', 'operator'].includes(args.initiatedBy)) {
      // Who asked matters legally, so it is required rather than defaulted.
      return { ok: false, error: 'Say whether the player asked or the operator decided' }
    }
    if (!(await reachable(ctx, playerId))) {
      return { ok: false, error: 'That player is not in your books' }
    }

    const flagType = args.flagType as RgFlagType
    let minTermEndsAt: Date | null = null
    let endsAt: Date | null = null

    if (flagType === 'SELF_EXCLUSION') {
      // `Number(x) || DEFAULT` substitutes only for 0 and NaN, so -6 passed
      // straight through and produced a minimum term that had already ended —
      // defeating the one lift guard that is not about who is asking. The
      // cooling-off branch below already rejects a date in the past; this is
      // the same rule, stated for a duration.
      const months =
        args.minTermMonths === undefined || args.minTermMonths === null
          ? DEFAULT_SELF_EXCLUSION_MONTHS
          : Number(args.minTermMonths)
      if (!Number.isInteger(months) || months < 1 || months > MAX_SELF_EXCLUSION_MONTHS) {
        return {
          ok: false,
          error: `A self-exclusion runs for 1 to ${MAX_SELF_EXCLUSION_MONTHS} months`,
        }
      }
      const d = new Date()
      d.setMonth(d.getMonth() + months)
      minTermEndsAt = d
    } else if (flagType === 'COOLING_OFF') {
      if (!args.endsAt) return { ok: false, error: 'A cooling-off period needs an end date' }
      endsAt = new Date(args.endsAt)
      if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
        return { ok: false, error: 'The end date must be in the future' }
      }
    }

    const res = await raiseRgFlag({
      tenant: user.tenant,
      playerId,
      flagType,
      initiatedBy: args.initiatedBy as 'player' | 'operator',
      reason: args.reason ?? null,
      minTermEndsAt,
      endsAt,
      raisedBy: `crm:${user.id}`,
    })

    if (!res.ok) {
      return {
        ok: false,
        error:
          res.reason === 'already_active'
            ? 'That flag is already active for this player'
            : res.reason === 'min_term_required'
              ? 'A self-exclusion needs a minimum term'
              : res.reason === 'ends_at_required'
                ? 'A cooling-off period needs an end date'
                : 'Player not found',
      }
    }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm.rg',
      action: 'raise_flag',
      resourceType: 'player',
      resourceId: String(playerId),
      before: {
        flagType,
        blocked: res.blocked,
        balanceAtBlock: res.balanceAtBlock,
        initiatedBy: args.initiatedBy,
      },
    }).catch(() => {})

    return { ok: true, error: null }
  },

  crmLiftRgFlag: async (
    _: unknown,
    args: { flagId: string; reason: string },
    ctx: CrmContext
  ) => {
    // A different permission from raising, because this is the direction that
    // lets a player be reached and take money again.
    requireCrmPermission(ctx, 'crm.rg', 'lift')
    requireCrmWrite(ctx)
    const user = requireCrmUser(ctx)

    // Every other RG resolver in this file checks `reachable`; the one that
    // un-blocks a player did not. A flag id survives the player being moved to
    // another book, so holding one from a period of legitimate access was
    // enough to lift an exclusion for someone outside the caller's scope.
    const res = await liftRgFlag({
      tenant: user.tenant,
      flagId: args.flagId,
      liftedBy: `crm:${user.id}`,
      reason: String(args.reason ?? ''),
      canReach: (playerId) => reachable(ctx, playerId),
    })

    if (!res.ok) {
      const message = {
        not_found: 'Flag not found',
        not_active: 'That flag is not active',
        same_principal: 'Someone other than the person who raised it must lift it',
        before_min_term: 'This cannot be lifted before its minimum term ends',
        reason_required: 'A reason is required',
      }[res.reason]
      return { ok: false, error: message }
    }

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm.rg',
      action: 'lift_flag',
      resourceType: 'crm_rg_flag',
      resourceId: args.flagId,
      // The player, not only the flag: "who un-blocked this person" was
      // otherwise a join away from an id nobody has to hand.
      before: { reason: args.reason, playerId: res.playerId },
    }).catch(() => {})

    return { ok: true, error: null }
  },

  crmRecordConsent: async (
    _: unknown,
    args: {
      playerId: string
      channel: string
      purpose: string
      state: string
      source: string
      evidenceRef?: string
      consentTextVersion?: string
      reason?: string
    },
    ctx: CrmContext
  ) => {
    const user = requireCrmUser(ctx)
    requireCrmWrite(ctx)

    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) return { ok: false, error: 'Unknown player' }
    if (!CHANNELS.includes(args.channel as ConsentChannel)) return { ok: false, error: 'Unknown channel' }
    if (!PURPOSES.includes(args.purpose as ConsentPurpose)) return { ok: false, error: 'Unknown purpose' }
    if (!['GRANTED', 'WITHDRAWN', 'REFUSED'].includes(args.state)) {
      return { ok: false, error: 'Unknown consent state' }
    }

    // Withdrawing is never gated — a player asking to be left alone must always
    // succeed. Granting or restoring is the permissioned direction.
    if (args.state === 'GRANTED') requireCrmPermission(ctx, 'crm.consent', 'restore')
    else requireCrmPermission(ctx, 'crm.consent', 'record')

    if (!(await reachable(ctx, playerId))) {
      return { ok: false, error: 'That player is not in your books' }
    }

    // The database enforces this too; refusing here gives a usable message
    // instead of a constraint violation.
    if (['AGENT_VERBAL', 'IMPORT'].includes(args.source) && !args.evidenceRef?.trim()) {
      return {
        ok: false,
        error: 'A verbal or imported consent needs a reference to the recording or file',
      }
    }

    const req = ctx.request as { headers?: Record<string, unknown> } | undefined
    await recordConsent({
      tenant: user.tenant,
      playerId,
      channel: args.channel as ConsentChannel,
      purpose: args.purpose as ConsentPurpose,
      toState: args.state as ConsentState,
      source: args.source as never,
      consentTextVersion: args.consentTextVersion ?? null,
      evidenceRef: args.evidenceRef ?? null,
      ipAddress: crmClientIp(ctx),
      userAgent: typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      actorKind: 'crm',
      actorId: user.id,
      reason: args.reason ?? null,
    })

    recordAuditDb({
      tenant: user.tenant,
      actorId: `crm:${user.id}`,
      domain: 'crm.consent',
      action: 'record_consent',
      resourceType: 'player',
      resourceId: String(playerId),
      before: { channel: args.channel, purpose: args.purpose, state: args.state, source: args.source },
    }).catch(() => {})

    return { ok: true, error: null }
  },
}
