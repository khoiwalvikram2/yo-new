import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo';
import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { AgentLedgerRepo } from '../../../repos/agents/AgentLedgerRepo';
import { db } from '@/db/client';
import { eq, sql } from 'drizzle-orm';
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';
import { ensureAgentCanMutate, hasPermission } from '@/domains/common/auth.js';
import { CREDIT_MOVES_AS_CHIPS } from '../schemeIsolation.js';

const MAX_FINANCIAL_AMOUNT = 1_000_000_000;

/**
 * Refuses a caller holding none of the given permissions.
 *
 * `executeSettleAgent` checked `settlements.agent:create`; the money mutations
 * beside it checked nothing at all beyond `ensureAgentCanMutate` and the
 * presence of a user id. `payCommission`, `createCommissionAdjustment`,
 * `applyCommissionAdjustment`, `adjustPlayerCredit` and `bulkSettleAgents` all
 * moved balances for any authenticated caller.
 *
 * Several take more than one permission because two different principals reach
 * them legitimately: the finance screens (`settlements.*`, from flat
 * `finance:write`) and an agent acting on its own downline (`agents.*`, from
 * flat `agents:manage`). `deriveAgentPermissions` grants no finance permission,
 * so naming only the settlements pair would refuse every agent.
 */
function requireAny(ctx: any, required: [string, string][], what: string): void {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  const perms = ctx?.permissions ?? []
  if (!required.some(([domain, action]) => hasPermission(perms, domain, action))) {
    throw new Error(
      `Forbidden: insufficient permissions to ${what} (${required.map(([d, a]) => `${d}:${a}`).join(' or ')})`
    )
  }
}

/** Back-office commission corrections. Admin finance only — no agent route. */
const COMMISSION_ADJUSTMENT: [string, string][] = [['settlements.commission', 'create']]
/** Paying a commission cycle out, reachable from finance and by an agent. */
const COMMISSION_PAYOUT: [string, string][] = [
  ['settlements.commission', 'create'],
  ['agents.commission', 'update'],
]
/** Agent settlement, matching the pair `AgentsMutation.settleAgent` uses. */
const AGENT_SETTLEMENT: [string, string][] = [
  ['settlements.agent', 'create'],
  ['agents.credit', 'update'],
]
/** The finance-screen half of AGENT_SETTLEMENT; what an admin caller needs. */
const ADMIN_AGENT_SETTLEMENT: [string, string][] = [['settlements.agent', 'create']]

/**
 * The permission gate for settling an agent (settleAgent and bulkSettleAgents).
 *
 * This used to demand `settlements.agent:create` from everyone. That is
 * `finance:write`, which `deriveAgentPermissions` never grants, so every
 * agent's Settle button was refused even though the rest of this function was
 * written for agent callers and `AGENT_SETTLEMENT` sat here unused.
 *
 * An agent passes on `agents.credit:update` (its `agents:manage`) and is then
 * held to its direct children by `executeSettleAgent`. An admin still needs the
 * finance permission, exactly as before, so no admin gains access here.
 */
export function requireSettleAgentPermission(ctx: any): void {
  requireAny(ctx, ctx?.user?.type === 'agent' ? AGENT_SETTLEMENT : ADMIN_AGENT_SETTLEMENT, 'settle agents')
}

/**
 * Whether an agent caller may settle `target`. Settlement posting is
 * deliberately DIRECT-CHILD-ONLY for agents:
 *  - never itself: an agent zeroing its own balance with its upline is the
 *    upline's decision, not its own;
 *  - never a grandchild: the grandchild's own parent settles it, and settling
 *    past that parent would move money behind its back.
 */
export function agentMaySettle(callerAgentId: string | null | undefined, target: { id: string; parentAgentId?: string | null }): boolean {
  if (!callerAgentId) return false
  if (target.id === callerAgentId) return false
  return target.parentAgentId === callerAgentId
}

async function executeSettleAgent(input: any, ctx: any) {
  ensureAgentCanMutate(ctx)
  requireSettleAgentPermission(ctx)
  // CRITICAL: For Director Admin, use effective tenant based on mode
  const directorTenant = getEffectiveTenantForDirector(ctx)
  const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
  const userId = ctx?.user?.sub || ctx?.user?.id; // JWT payload uses 'sub', fallback to 'id'
  
  if (!userId) {
    return {
      success: false,
      message: 'Unauthorized: User ID required',
      settlement: null,
    };
  }
  
  // Block commission agents from accessing settlement operations
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
    const agentsRepo = new AgentsRepo();
    const loggedInAgent = await agentsRepo.findById(ctx.user.agentId);
    if (loggedInAgent?.schemeType === 'COMMISSION') {
      return {
        success: false,
        message: 'Commission agents cannot access settlement operations. Use commission payouts instead.',
        settlement: null,
      };
    }
  }
  
  // Validate input (amount can be 0 for SHARING - backend will use full computed amount)
    if (!input.agentId || !input.settlementType || !input.direction) {
      return {
        success: false,
        message: 'Missing required fields: agentId, settlementType, and direction are required',
        settlement: null,
      };
    }
    const amountNum = Number(input.amount);
    if (input.amount == null || input.amount === '' || !Number.isFinite(amountNum) || amountNum < 0) {
      return {
        success: false,
        message: 'Settlement amount must be a non-negative number',
        settlement: null,
      };
    }
    if (amountNum > MAX_FINANCIAL_AMOUNT) {
      return {
        success: false,
        message: `Settlement amount cannot exceed ${MAX_FINANCIAL_AMOUNT.toLocaleString()}`,
        settlement: null,
      };
    }
    input.amount = amountNum;

    // Trim and validate notes (min length, basic sanitization)
    const notesRaw = typeof input.notes === 'string' ? input.notes : String(input.notes ?? '');
    const notes = notesRaw.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 500);
    if (notes.length < 3) {
      return {
        success: false,
        message: 'Notes must be at least 3 characters (after trimming)',
        settlement: null,
      };
    }
    input.notes = notes;
    
    // Verify agent exists and belongs to tenant
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(input.agentId);
    
    if (agent && agent.tenantId !== tenant) {
      return {
        success: false,
        message: 'Agent not found or does not belong to this tenant',
        settlement: null,
      };
    }
    
    if (!agent) {
      return {
        success: false,
        message: 'Agent not found',
        settlement: null,
      };
    }

    // An agent settles its DIRECT sub-agents only — never itself, never a
    // grandchild (see agentMaySettle). Checked straight after the lookup, before
    // any scheme or balance detail of the target is read or echoed back. This
    // used to allow `isSelf`, so an agent could zero its own settlement balance.
    if (ctx?.user?.type === 'agent' && !agentMaySettle(ctx?.user?.agentId, agent)) {
      return {
        success: false,
        message: 'You can only settle your direct sub-agents.',
        settlement: null,
      };
    }

    // Amount validation: allow 0 for SHARING (meaning "settle full amount"); require > 0 for COMMISSION
    if (input.amount < 0) {
      return {
        success: false,
        message: 'Settlement amount cannot be negative',
        settlement: null,
      };
    }
    if (agent.schemeType === 'COMMISSION' && input.amount <= 0) {
      return {
        success: false,
        message: 'Settlement amount must be greater than 0',
        settlement: null,
      };
    }
    
    // Verify settlement type matches agent scheme
    if (agent.schemeType === 'COMMISSION' && input.settlementType !== 'COMMISSION') {
      return {
        success: false,
        message: 'Commission agents cannot have P/L or CREDIT settlements',
        settlement: null,
      };
    }
    
    if (agent.schemeType === 'COMMISSION') {
      return {
        success: false,
        message: 'Use payCommission mutation for commission agents',
        settlement: null,
      };
    }

    // CREDIT no longer settles here (spec §6, 2026-11-02): its chips move only by
    // Deposit / Withdraw between direct parent and child, and settling is a D/W
    // of the account's Ref P/L. Refused after the direct-child check above, so an
    // agent learns nothing about a target it may not settle.
    if (agent.schemeType === 'CREDIT') {
      return {
        success: false,
        message: CREDIT_MOVES_AS_CHIPS,
        settlement: null,
      };
    }

    // Validate settlement type matches agent scheme
    if (agent.schemeType === 'SHARING' && input.settlementType !== 'P_L') {
      return {
        success: false,
        message: 'SHARING agents can only have P_L settlements.',
        settlement: null,
      };
    }

    // (The agent-caller direct-child check runs right after the agent lookup above.)

    // Convert userId to UUID format if needed, or set to null if invalid
    let settledByUuid: string | null = null;
    if (userId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(userId)) {
        settledByUuid = userId;
      }
    }

    // SHARING (P_L): the whole settlement runs through SharingSettlementEngine in
    // one transaction, under a per-agent lock (so a concurrent second settle waits
    // and then sees this one's lines):
    //  - the open window [periodFrom, periodTo), half-open: it starts where the last
    //    settled window ended (or at that window's start again if it left something
    //    owed) and ends now — or at the window end the caller was shown (the pending
    //    row's periodTo), so the displayed amount is exactly what is posted;
    //  - the window's share: the same GGR reader, window and per-rate-segment maths
    //    as every pending figure, posted as SHARE lines that tile the window;
    //  - the cap: what is still owed (share − settled, signed). The direction is the
    //    sign of what is owed (positive = TO_AGENT: players lost, the agent is paid
    //    its share); input.direction is ignored for SHARING;
    //  - the settlement record, the SETTLEMENT line, the audit row and the wallets:
    //    the agent's, and for a sub-agent also its parent's, which funds it (a
    //    sub-agent's share is part of its parent's cumulative share).
    if (agent.schemeType === 'SHARING' && input.settlementType === 'P_L') {
      const { getAppConfigDb } = await import('../../../repos/app-config/appConfigRepo.js');
      const appConfig = await getAppConfigDb(agent.tenantId);
      const currency = appConfig?.baseCurrency || 'INR';
      let requestedPeriodTo: Date | null = null;
      if (input.periodTo != null && input.periodTo !== '') {
        requestedPeriodTo = new Date(input.periodTo);
        if (Number.isNaN(requestedPeriodTo.getTime())) {
          return {
            success: false,
            message: 'Invalid periodTo for the SHARING settlement window.',
            settlement: null,
          };
        }
      }
      const { runSharingSettlement } = await import('../../agents/services/sharingSettlementWiring.js');
      let outcome: any;
      try {
        outcome = await runSharingSettlement({
          agent,
          currency,
          tenant,
          notes: input.notes,
          requestedAmount: input.amount,
          requestedPeriodTo,
          settledByAgentId: (ctx?.user?.type === 'agent' && ctx?.user?.agentId) ? ctx.user.agentId : null,
          settledByUuid,
        });
      } catch (error: any) {
        // CR-16: unique-violation on (agent_id, period_from, period_to) for OPEN rows means a
        // concurrent settle is already in flight for this period. Treat as already-settled.
        const code = error?.code ?? error?.constraint;
        if (
          code === '23505' ||
          (typeof code === 'string' && code.includes('agent_settlements_agent_period_open_key'))
        ) {
          return {
            success: false,
            message: 'A settlement for this period is already in progress. Please retry in a moment.',
            settlement: null,
          };
        }
        return {
          success: false,
          message: error?.message || 'Failed to complete settlement. All operations rolled back.',
          settlement: null,
        };
      }
      if (!outcome?.ok) {
        return {
          success: false,
          message: outcome?.message || 'Nothing to settle for this SHARING agent.',
          settlement: null,
        };
      }

      const { agentCredentials: agentCredentialsShare } = await import('@shared/db/schema/agents');
      const [credentialShare] = await db
        .select()
        .from(agentCredentialsShare)
        .where(eq(agentCredentialsShare.agentId, input.agentId))
        .limit(1);
      const sharingTxn = outcome.transaction;
      return {
        success: true,
        message: 'Settlement completed successfully',
        settlement: {
          ...sharingTxn,
          agent: {
            id: agent.id,
            username: credentialShare?.username || null,
            schemeType: agent.schemeType,
          },
          createdAt: sharingTxn?.createdAt instanceof Date ? sharingTxn.createdAt.toISOString() : String(sharingTxn?.createdAt ?? new Date().toISOString()),
        },
      };
    }

    // SHARING P_L settlements are completed (and returned) above by
    // SharingSettlementEngine; COMMISSION and CREDIT, and every other
    // scheme/type combination, were refused earlier. Reaching this point is a
    // programming error.
    return {
      success: false,
      message: 'Unsupported settlement type for this agent.',
      settlement: null,
    };
}

export const settlementsMutationResolvers = {
  settleAgent: async (_: any, args: any, ctx: any) => executeSettleAgent(args.input, ctx),

  // Commission payouts are create-only and immutable (no update/delete). Enforced in CommissionPayoutsRepo.
  payCommission: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requireAny(ctx, COMMISSION_PAYOUT, 'pay commission')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const userId = ctx?.user?.sub || ctx?.user?.id; // JWT payload uses 'sub', fallback to 'id'
    const isAgentCaller = ctx?.user?.type === 'agent' && ctx?.user?.agentId;
    
    if (!userId && !isAgentCaller) {
      return {
        success: false,
        message: 'Unauthorized: User or agent ID required',
        payout: null,
      };
    }
    
    const { input } = args;
    
    // Validate input
    if (!input.agentId || !input.notes) {
      return {
        success: false,
        message: 'Missing required fields: agentId and notes are required',
        payout: null,
      };
    }
    const amountNum = Number(input.amount);
    if (input.amount == null || input.amount === '' || !Number.isFinite(amountNum) || amountNum <= 0) {
      return {
        success: false,
        message: 'Commission payout amount must be a number greater than 0',
        payout: null,
      };
    }
    if (amountNum > MAX_FINANCIAL_AMOUNT) {
      return {
        success: false,
        message: `Commission payout amount cannot exceed ${MAX_FINANCIAL_AMOUNT.toLocaleString()}`,
        payout: null,
      };
    }
    input.amount = amountNum;

    // Verify agent exists and is COMMISSION type
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(input.agentId);
    
    if (!agent) {
      return {
        success: false,
        message: 'Agent not found',
        payout: null,
      };
    }
    
    if (agent.tenantId !== tenant) {
      return {
        success: false,
        message: 'Agent not found or does not belong to this tenant',
        payout: null,
      };
    }

    // An agent pays its DIRECT sub-agents only. This ran at the very end, after
    // the existing payout, the readiness reasons and the cycle payable had all
    // been read — and returned in messages ("Amount must equal cycle payable
    // (…)", "Already paid", "Cycle not ready: …") — so any agent could read a
    // parent's or a sibling's payable. Checked straight after the lookup now,
    // before any payout figure is touched.
    if (ctx?.user?.type === 'agent' && !agentMaySettle(ctx?.user?.agentId, agent)) {
      return {
        success: false,
        message: 'You can only pay commission for your direct sub-agents.',
        payout: null,
      };
    }

    if (agent.schemeType !== 'COMMISSION') {
      return {
        success: false,
        message: 'Only COMMISSION agents can receive commission payouts',
        payout: null,
      };
    }

    // An admin pays the top of each commission chain only. A sub-agent's
    // commission is already inside its parent's gross (the admin side pays in
    // 'gross' mode), and the parent pays the sub-agent the sub-agent's gross from that;
    // an admin paying the sub-agent directly paid the same money twice.
    if (ctx?.user?.type !== 'agent' && agent.parentAgentId) {
      const parentAgent = await agentsRepo.findById(agent.parentAgentId);
      if (parentAgent && parentAgent.schemeType === 'COMMISSION') {
        return {
          success: false,
          message: 'This is a sub-agent: its commission is paid by its parent agent. Pay the top-level commission agent instead.',
          payout: null,
        };
      }
    }

    // Full-cycle settlement only: require IST Monday->Monday period
    if (!input.periodFrom || !input.periodTo) {
      return {
        success: false,
        message: 'Period required: periodFrom and periodTo (IST Monday–Monday cycle) are required for commission payout',
        payout: null,
      };
    }
    const { validateCycleIST, parseCycleDateIST, isCurrentCycleIST } = await import('../../agents/services/CommissionCycleUtils.js');
    const periodFrom = parseCycleDateIST(input.periodFrom);
    const periodTo = parseCycleDateIST(input.periodTo);
    const cycleValidation = validateCycleIST(periodFrom, periodTo);
    if (!cycleValidation.isValid) {
      return {
        success: false,
        message: cycleValidation.error ?? 'Invalid settlement period',
        payout: null,
      };
    }

    // CR-14: Never settle the current OPEN cycle — late settlements could change the
    // amount, and the unique index would lock the premature amount forever.
    if (isCurrentCycleIST(periodFrom, periodTo)) {
      throw new Error('Cannot pay an open/current cycle');
    }

    const payoutsRepo = new CommissionPayoutsRepo();
    const existingPayout = await payoutsRepo.getPayoutForCycle(tenant, input.agentId, periodFrom, periodTo);
    if (existingPayout) {
      const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js');
      const actorId = String(isAgentCaller ? ctx?.user?.agentId : (ctx?.user?.sub ?? ctx?.user?.id ?? 'system'));
      try {
        await recordAuditDb({
          tenant,
          actorId,
          domain: 'settlements',
          action: 'commission_payout_already_paid',
          resourceType: 'commission_payout',
          resourceId: existingPayout.id,
          before: null,
          after: { agentId: input.agentId, periodFrom: periodFrom.toISOString(), periodTo: periodTo.toISOString(), amount: existingPayout.amount },
        });
      } catch (_) {}
      const { agentCredentials } = await import('@shared/db/schema/agents');
      const [credential] = await db.select().from(agentCredentials).where(eq(agentCredentials.agentId, input.agentId)).limit(1);
      return {
        success: true,
        message: 'Already paid for this cycle',
        payout: {
          ...existingPayout,
          agent: { id: agent.id, username: credential?.username ?? null, schemeType: agent.schemeType },
          periodFrom: existingPayout.periodFrom?.toISOString() ?? null,
          periodTo: existingPayout.periodTo?.toISOString() ?? null,
          createdAt: existingPayout.createdAt.toISOString(),
        },
      };
    }

    const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js');
    const { HybridGGRReader } = await import('../../agents/services/HybridGGRReader.js');
    const { getWhitelabelCurrency } = await import('@src/shared/whitelabelConfig.js');
    const currency = await getWhitelabelCurrency(tenant).catch(() => 'INR');
    const configsRepo = new AgentConfigsRepo();
    const ledgerRepo = new AgentLedgerRepo();
    const ggrReaders = new HybridGGRReader();
    // The payee is owed its GROSS whoever pays: the admin pays a root agent its
    // gross, and a parent pays a direct child the child's gross (its rate x its
    // whole subtree's GGR) — the child pays its own children out of that. Paying a
    // child its net (as agent callers did) left the child out of pocket by what it
    // owes its own children (A 10% -> B 8% -> C 5% on a 1000 loss: A paid B 30,
    // B paid C 50).
    const commissionMode = 'gross' as const;

    // CR-14: Gate settlement on cycle readiness. A closed cycle must be "ready"
    // (no open bets placed in it, no unresolved adjustments) before it can be paid.
    // LEDGER_GAP is informational and does NOT block (product decision). Terminal
    // markers READY / ZERO_PAYABLE_NET are not blocking reasons.
    const { CommissionReadinessService } = await import('../../agents/services/CommissionReadinessService.js');
    const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
    const adjustmentsRepo = new CommissionAdjustmentsRepo();
    const readinessService = new CommissionReadinessService(agentsRepo, configsRepo, ledgerRepo, payoutsRepo, {
      ggrReaders,
      adjustments: adjustmentsRepo,
    });
    const readiness = await readinessService.getReadiness(
      input.agentId,
      periodFrom,
      periodTo,
      tenant,
      currency,
      commissionMode,
    );
    if (!readiness.ready) {
      const blockingReasons = readiness.reasons.filter(
        r => r !== 'LEDGER_GAP' && r !== 'READY' && r !== 'ZERO_PAYABLE_NET',
      );
      // Only hard-block on genuine blocking reasons (e.g. NOT_CLOSED, MISSING_BETS,
      // UNRESOLVED_ADJUSTMENT). ZERO_PAYABLE_NET falls through to the existing
      // "No payable commission" structured response below.
      if (blockingReasons.length > 0) {
        throw new Error('Cycle not ready: ' + blockingReasons.join(', '));
      }
    }

    // The cycle payable: gross (tally rules) + applied adjustments - paid, rounded —
    // computed once, by readiness, so the gate and the amount check use one figure.
    const payable = readiness.payableAmount;
    if (payable <= 0) {
      return {
        success: false,
        message:
          'No payable commission for this cycle: net commission is zero or negative after tally rules. Full-cycle settlement only.',
        payout: null,
      };
    }
    const PAY_EPSILON = 0.01;
    if (Math.abs(amountNum - payable) > PAY_EPSILON) {
      return {
        success: false,
        message: `Amount must equal cycle payable (${payable.toFixed(2)}, calculated using tally rules). Full-cycle settlement only.`,
        payout: null,
      };
    }

    // The direct-sub-agent check for agent callers runs right after the agent lookup.
    let paidByUuid: string | null = null;
    if (isAgentCaller) {
      paidByUuid = ctx.user.agentId; // Store parent agent ID as paidBy when paid by parent
    } else if (userId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(userId)) {
        paidByUuid = userId;
      }
    }
    
    // Create commission payout record (when agent pays sub-agent, use transaction + lock to prevent double payout)
    const createPayout = async (tx: any) => {
      // When parent agent is paying, lock the sub-agent row so concurrent pay calls are serialized
      if (isAgentCaller) {
        await (tx as any).execute(sql`
          SELECT id FROM agents WHERE id = ${input.agentId} FOR UPDATE LIMIT 1
        `);
      }
      return payoutsRepo.create(
        {
          tenant,
          agentId: input.agentId,
          amount: payable,
          periodFrom: periodFrom,
          periodTo: periodTo,
          notes: input.notes,
          paidBy: paidByUuid ?? undefined,
        },
        tx
      );
    };
    let payout: any;
    try {
      payout = isAgentCaller
        ? await db.transaction(createPayout)
        : await createPayout(db);
    } catch (err: any) {
      const code = err?.code ?? err?.constraint;
      if (code === '23505' || (typeof code === 'string' && code.includes('commission_payouts_agent_cycle_key'))) {
        const existing = await payoutsRepo.getPayoutForCycle(tenant, input.agentId, periodFrom, periodTo);
        if (existing) {
          const { agentCredentials } = await import('@shared/db/schema/agents');
          const [credential] = await db.select().from(agentCredentials).where(eq(agentCredentials.agentId, input.agentId)).limit(1);
          return {
            success: true,
            message: 'Already paid for this cycle',
            payout: {
              ...existing,
              agent: { id: agent.id, username: credential?.username ?? null, schemeType: agent.schemeType },
              periodFrom: existing.periodFrom?.toISOString() ?? null,
              periodTo: existing.periodTo?.toISOString() ?? null,
              createdAt: existing.createdAt.toISOString(),
            },
          };
        }
      }
      throw err;
    }

    const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js');
    const actorId = String(isAgentCaller ? ctx?.user?.agentId : (ctx?.user?.sub ?? ctx?.user?.id ?? 'system'));
    try {
      await recordAuditDb({
        tenant,
        actorId,
        domain: 'settlements',
        action: 'commission_payout',
        resourceType: 'commission_payout',
        resourceId: payout.id,
        before: null,
        after: { agentId: input.agentId, periodFrom: periodFrom.toISOString(), periodTo: periodTo.toISOString(), amount: payout.amount },
      });
    } catch (_) {}

    // Create notification for commission payout (informational)
    try {
      const whitelabelId = directorTenant ?? tenant;
      const { getWhitelabelCurrency, getCurrencySymbol } = await import('@src/shared/whitelabelConfig.js');
      const currency = await getWhitelabelCurrency(whitelabelId);
      const sym = getCurrencySymbol(currency);
      const { NotificationsRepo } = await import('@/repos/notifications/notificationsRepo.js');
      const { NotificationService } = await import('@/domains/notifications/services/NotificationService.js');
      const notificationsRepo = new NotificationsRepo();
      const notificationService = new NotificationService(notificationsRepo);
      const formattedAmount = typeof input.amount === 'number' ? input.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(input.amount);
      const periodText = input.periodFrom && input.periodTo 
        ? ` (${new Date(input.periodFrom).toLocaleDateString()} - ${new Date(input.periodTo).toLocaleDateString()})`
        : '';
      await notificationService.createNotification(
        {
          tenant,
          whitelabelId: whitelabelId || tenant,
          agentId: input.agentId,
          type: 'COMMISSION',
          category: 'task',
          title: 'Commission payout processed',
          message: `Commission payout of ${sym}${formattedAmount}${periodText} for agent has been processed.`,
          // The recipient is the paid agent (agentId above), always a COMMISSION
          // agent, whose own payout history lives at /commission/history. The old
          // /settlements/commission link matched no route in the admin app.
          actionUrl: '/commission/history?tab=my',
          metadata: { payoutId: payout.id, agentId: input.agentId, amount: input.amount, periodFrom: input.periodFrom, periodTo: input.periodTo },
        },
        ctx?.pubsub
      );
    } catch (err: any) {
    }
    
    // Commission payout is recorded in commission_payouts table
    // Ledger updates can be handled separately if needed
    
    // Get agent details for response
    const { agentCredentials } = await import('@shared/db/schema/agents');
    const [credential] = await db
      .select()
      .from(agentCredentials)
      .where(eq(agentCredentials.agentId, input.agentId))
      .limit(1);
    
    return {
      success: true,
      message: 'Commission payout completed successfully',
      payout: {
        ...payout,
        agent: {
          id: agent.id,
          username: credential?.username || null,
          schemeType: agent.schemeType,
        },
        periodFrom: payout.periodFrom?.toISOString() || null,
        periodTo: payout.periodTo?.toISOString() || null,
        createdAt: payout.createdAt.toISOString(),
      },
    };
  },

  createCommissionAdjustment: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx);
    requireAny(ctx, COMMISSION_ADJUSTMENT, 'adjust commission')
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const { input } = args;
    if (!input?.agentId || input.amount == null || !input.sourceCycleFrom || !input.sourceCycleTo || !input.reason) {
      return { success: false, message: 'Missing required fields: agentId, amount, sourceCycleFrom, sourceCycleTo, reason', adjustment: null };
    }
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(input.agentId);
    if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'COMMISSION') {
      return { success: false, message: 'Agent not found or not COMMISSION', adjustment: null };
    }
    const { validateCycleIST, isCurrentCycleIST, parseCycleDateIST } = await import('../../agents/services/CommissionCycleUtils.js');
    // IM: cycle dates must be parsed as IST midnight so they match the IST cycle bounds
    // used by payCommission / getReadiness / sumAppliedForCycle (which compare exact instants).
    const periodFrom = parseCycleDateIST(input.sourceCycleFrom);
    const periodTo = parseCycleDateIST(input.sourceCycleTo);
    const validation = validateCycleIST(periodFrom, periodTo);
    if (!validation.isValid) {
      return { success: false, message: validation.error ?? 'Invalid source cycle', adjustment: null };
    }
    if (isCurrentCycleIST(periodFrom, periodTo)) {
      return { success: false, message: 'Adjustments cannot target the current open cycle', adjustment: null };
    }
    const amount = Number(input.amount);
    if (!Number.isFinite(amount)) {
      return { success: false, message: 'Invalid amount', adjustment: null };
    }
    // The same ceiling every other money path here enforces. This one checked
    // only that the number was finite, and an adjustment may be negative, so
    // the bound is on magnitude.
    if (Math.abs(amount) > MAX_FINANCIAL_AMOUNT) {
      return {
        success: false,
        message: `Adjustment amount cannot exceed ${MAX_FINANCIAL_AMOUNT.toLocaleString()}`,
        adjustment: null,
      };
    }
    let refMeta: Record<string, unknown> | null = null;
    if (input.refMeta && typeof input.refMeta === 'string') {
      try {
        refMeta = JSON.parse(input.refMeta) as Record<string, unknown>;
      } catch {
        refMeta = null;
      }
    }
    const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
    const repo = new CommissionAdjustmentsRepo();
    const row = await repo.create({
      tenantId: tenant,
      agentId: input.agentId,
      amount,
      sourceCycleFrom: periodFrom,
      sourceCycleTo: periodTo,
      reason: String(input.reason).slice(0, 64),
      refMeta,
    });
    const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js');
    const actorId = String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system');
    try {
      await recordAuditDb({
        tenant,
        actorId,
        domain: 'settlements',
        action: 'commission_adjustment_create',
        resourceType: 'commission_adjustment',
        resourceId: row.id,
        before: null,
        after: { agentId: input.agentId, amount: row.amount, sourceCycleFrom: row.sourceCycleFrom.toISOString(), sourceCycleTo: row.sourceCycleTo.toISOString(), reason: row.reason },
      });
    } catch (_) {}
    return {
      success: true,
      message: 'Adjustment created; apply to a cycle to affect payable',
      adjustment: {
        id: row.id,
        agentId: row.agentId,
        amount: row.amount,
        sourceCycleFrom: row.sourceCycleFrom.toISOString(),
        sourceCycleTo: row.sourceCycleTo.toISOString(),
        targetCycleFrom: row.targetCycleFrom?.toISOString() ?? null,
        targetCycleTo: row.targetCycleTo?.toISOString() ?? null,
        reason: row.reason,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        appliedAt: row.appliedAt?.toISOString() ?? null,
      },
    };
  },

  applyCommissionAdjustment: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx);
    requireAny(ctx, COMMISSION_ADJUSTMENT, 'apply a commission adjustment')
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const { input } = args;
    if (!input?.adjustmentId || !input?.targetCycleFrom || !input?.targetCycleTo) {
      return { success: false, message: 'Missing adjustmentId, targetCycleFrom, targetCycleTo', adjustment: null };
    }
    const { validateCycleIST, parseCycleDateIST } = await import('../../agents/services/CommissionCycleUtils.js');
    // IM: parse target cycle dates as IST midnight so the stored targetCycleFrom/To match
    // the IST bounds that payCommission and sumAppliedForCycle query with (exact-instant eq).
    const targetFrom = parseCycleDateIST(input.targetCycleFrom);
    const targetTo = parseCycleDateIST(input.targetCycleTo);
    const validation = validateCycleIST(targetFrom, targetTo);
    if (!validation.isValid) {
      return { success: false, message: validation.error ?? 'Invalid target cycle', adjustment: null };
    }
    const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
    const repo = new CommissionAdjustmentsRepo();
    const adjustment = await repo.getById(input.adjustmentId, tenant);
    if (!adjustment) {
      return { success: false, message: 'Adjustment not found', adjustment: null };
    }
    const agentsRepo = new AgentsRepo();
    const agent = await agentsRepo.findById(adjustment.agentId);
    if (!agent || agent.schemeType !== 'COMMISSION') {
      return { success: false, message: 'Agent not found or not COMMISSION', adjustment: null };
    }
    // PENDING only: an APPLIED adjustment already moved a cycle, and a CANCELLED
    // one must never reach a payable (only APPLIED used to be refused here).
    if (adjustment.status !== 'PENDING') {
      return {
        success: false,
        message: adjustment.status === 'APPLIED'
          ? 'Adjustment already applied'
          : `Only a PENDING adjustment can be applied (this one is ${adjustment.status})`,
        adjustment: null,
      };
    }
    // IM: never apply an adjustment to an already-paid cycle — the payout is immutable and
    // locked by a unique index, so the adjustment could never affect payable (stuck-unsettleable).
    const payoutsRepo = new CommissionPayoutsRepo();
    const existingPayout = await payoutsRepo.getPayoutForCycle(tenant, adjustment.agentId, targetFrom, targetTo);
    if (existingPayout) {
      return { success: false, message: 'Cannot adjust an already-paid cycle', adjustment: null };
    }
    const updated = await repo.apply(input.adjustmentId, tenant, { targetCycleFrom: targetFrom, targetCycleTo: targetTo });
    if (!updated) {
      return { success: false, message: 'Adjustment is no longer PENDING; reload and try again', adjustment: null };
    }
    const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js');
    const actorId = String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system');
    try {
      await recordAuditDb({
        tenant,
        actorId,
        domain: 'settlements',
        action: 'commission_adjustment_apply',
        resourceType: 'commission_adjustment',
        resourceId: updated.id,
        before: null,
        after: { targetCycleFrom: targetFrom.toISOString(), targetCycleTo: targetTo.toISOString() },
      });
    } catch (_) {}
    return {
      success: true,
      message: 'Adjustment applied to cycle',
      adjustment: {
        id: updated.id,
        agentId: updated.agentId,
        amount: updated.amount,
        sourceCycleFrom: updated.sourceCycleFrom.toISOString(),
        sourceCycleTo: updated.sourceCycleTo.toISOString(),
        targetCycleFrom: updated.targetCycleFrom?.toISOString() ?? null,
        targetCycleTo: updated.targetCycleTo?.toISOString() ?? null,
        reason: updated.reason,
        status: updated.status,
        createdAt: updated.createdAt.toISOString(),
        appliedAt: updated.appliedAt?.toISOString() ?? null,
      },
    };
  },

  cancelCommissionAdjustment: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx);
    // Admins only (owner decision 3): settlements.commission:create, which
    // deriveAgentPermissions never grants, so every agent is refused here.
    requireAny(ctx, COMMISSION_ADJUSTMENT, 'cancel a commission adjustment')
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const { CommissionAdjustmentsRepo } = await import('@/repos/settlements/CommissionAdjustmentsRepo.js');
    const { cancelPendingAdjustment } = await import('../services/commissionAdjustmentCancel.js');
    return cancelPendingAdjustment(
      { adjustmentId: args?.adjustmentId, reason: args?.reason },
      { tenant, actorId: String(ctx?.user?.sub ?? ctx?.user?.id ?? 'system') },
      {
        repo: new CommissionAdjustmentsRepo(),
        audit: async (entry) => {
          const { recordAuditDb } = await import('@src/repos/audit/auditRepo.js');
          await recordAuditDb(entry);
        },
      },
    );
  },

  bulkSettleAgents: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    // Same gate as settleAgent; each agent is then settled through
    // executeSettleAgent, so an agent caller is held to its direct children
    // there (self and grandchildren count as failed).
    requireSettleAgentPermission(ctx)
    const directorTenant = getEffectiveTenantForDirector(ctx);
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const userId = ctx?.user?.sub || ctx?.user?.id;

    if (!userId) {
      return {
        success: false,
        message: 'Unauthorized: User ID required',
        settledCount: 0,
        failedCount: 0,
        settlements: [],
      };
    }

    const { agentIds } = args;
    if (!agentIds || agentIds.length === 0) {
      return {
        success: false,
        message: 'No agent IDs provided',
        settledCount: 0,
        failedCount: 0,
        settlements: [],
      };
    }

    const agentsRepo = new AgentsRepo();
    const settled: any[] = [];
    let failedCount = 0;
    const bulkNotes = `Bulk settlement - ${new Date().toISOString()}`;

    for (const agentId of agentIds) {
      try {
        const agent = await agentsRepo.findById(agentId);
        // Only SHARING settles here: COMMISSION is paid by payCommission, and
        // CREDIT moves as chips (Deposit / Withdraw), never through a settlement.
        if (!agent || agent.tenantId !== tenant || agent.schemeType !== 'SHARING') {
          failedCount++;
          continue;
        }
        const input = {
          agentId,
          settlementType: 'P_L',
          amount: 0, // full amount; executeSettleAgent computes it for SHARING
          direction: 'TO_AGENT',
          notes: bulkNotes,
        };
        const result = await executeSettleAgent(input, ctx);
        if (result.success && result.settlement) {
          settled.push(result.settlement);
        } else {
          failedCount++;
        }
      } catch (error: any) {
        failedCount++;
      }
    }

    return {
      success: true,
      message: `Bulk settlement completed: ${settled.length} settled, ${failedCount} failed`,
      settledCount: settled.length,
      failedCount,
      settlements: settled.map((s: any) => ({
        ...s,
        createdAt: s.createdAt?.toISOString?.() ?? new Date().toISOString(),
      })),
    };
  },
};

