import { AgentSettlementTransactionsRepo } from '../../../repos/settlements/AgentSettlementTransactionsRepo';
import { CommissionPayoutsRepo } from '../../../repos/settlements/CommissionPayoutsRepo';
import { PlayerCreditAdjustmentsRepo } from '../../../repos/settlements/PlayerCreditAdjustmentsRepo';
import { AgentsRepo } from '../../../repos/agents/AgentsRepo';
import { CreditService } from '../../agents/services/CreditService';
import { AgentLedgerRepo, shareLinesForExactWindow } from '../../../repos/agents/AgentLedgerRepo';
import { AgentSettlementsRepo as AgentSettlementsRepoOld } from '../../../repos/agents/AgentSettlementsRepo';
import { db } from '@/db/client';
import { agents, users, agentPlayerCredits } from '@shared/db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { applyPlayerCreditLimitDelta, applySettlementDeltas, lockAgentCreditRow, lockPlayerCreditRow } from '@/repos/agents/creditBalanceSql';
import { creditAvailableOf, isPlayerCreditAdjustmentType, shouldMoveWhitelabelPool } from '../../agents/services/creditMath';
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js';
import { ensureAgentCanMutate, hasPermission } from '@/domains/common/auth.js';
import {
	getWhitelabelTimezone,
	deriveSinceLastPeriod,
} from '../../agents/services/SettlementPeriodUtils.js';

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
/** Player credit in a CREDIT hierarchy, reachable from finance and by an agent. */
const PLAYER_CREDIT: [string, string][] = [
  ['settlements.credit', 'create'],
  ['agents.credit', 'update'],
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

    // Amount validation: allow 0 for SHARING/CREDIT (meaning "settle full amount"); require > 0 for COMMISSION
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

    // Validate settlement type matches agent scheme
    if (agent.schemeType === 'SHARING' && input.settlementType !== 'P_L') {
      return {
        success: false,
        message: 'SHARING agents can only have P_L settlements. CREDIT settlements are only for CREDIT agents.',
        settlement: null,
      };
    }
    
    // Validate CREDIT agents can only have CREDIT settlements
    if (agent.schemeType === 'CREDIT' && input.settlementType !== 'CREDIT') {
      return {
        success: false,
        message: 'CREDIT agents can only have CREDIT settlements. P_L settlements are only for SHARING agents.',
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

    // For CREDIT agents, use settlementBalance (SHARING returned above)
    let previousBalance = 0;
    let settlementAmount = 0;
    let calculatedDirection = input.direction;
    
    // For CREDIT agents, we'll get the balance inside the transaction to avoid race conditions
    // But we need to validate the agent has credit info first
    if (input.settlementType === 'CREDIT' && agent.schemeType === 'CREDIT') {
      // Quick validation check (will be re-checked in transaction with lock)
      const agentCreditCheck = await agentsRepo.getCreditFields(input.agentId);
      if (!agentCreditCheck) {
        return {
          success: false,
          message: 'Agent credit information not found',
          settlement: null,
        };
      }
      // Store for initial calculation, but will use locked value in transaction
      const balanceNum = Number(agentCreditCheck.settlementBalance);
      previousBalance = Number.isFinite(balanceNum) ? balanceNum : 0;
      settlementAmount = Math.abs(previousBalance);
      
      // Validate that CREDIT agent has a non-zero, finite settlement balance
      if (!Number.isFinite(settlementAmount) || settlementAmount < 0.01) {
        return {
          success: false,
          message: 'Cannot settle CREDIT agent with zero or invalid settlement balance. No settlement amount pending.',
          settlement: null,
        };
      }
      
      // Determine direction based on settlementBalance
      // Positive = agent owes (TO_AGENT), Negative = agent is owed (FROM_AGENT)
      calculatedDirection = previousBalance >= 0 ? 'TO_AGENT' : 'FROM_AGENT';
      
      // Use calculated amount and direction for CREDIT settlements
      input.amount = settlementAmount;
      input.direction = calculatedDirection;
    } else {
      // SHARING P_L settlements are completed (and returned) above by
      // SharingSettlementEngine; every other scheme/type combination was refused
      // earlier. Reaching this point is a programming error.
      return {
        success: false,
        message: 'Unsupported settlement type for this agent.',
        settlement: null,
      };
    }
    
    let newBalance = 0; // After settlement, balance is reset to 0
    
    // For CREDIT agents: Update settlementBalance and cascade to parent in transaction
    // Settlement record will be created inside transaction to ensure atomicity
    let settlement: any = null;
    
    if (input.settlementType === 'CREDIT' && agent.schemeType === 'CREDIT') {
      // Get currency from agent's whitelabel or default to INR
      const { getAppConfigDb } = await import('../../../repos/app-config/appConfigRepo.js');
      const appConfig = await getAppConfigDb(agent.tenantId);
      const currency = appConfig?.baseCurrency || 'INR';
      
      // settlementRecord will store the agent_settlements record for history
      let settlementRecord: any = null;
      
      try {
        await db.transaction(async (tx) => {
          // The comment that stood here said "with lock". It was not true:
          // `getCreditFields` is a plain SELECT, so two concurrent settlements of
          // the same CREDIT agent both read the same non-zero balance, both
          // cascaded it to the parent, and the parent was credited twice while
          // the child was zeroed once. The zero-balance guard below was written
          // for exactly that race and could never fire without this lock.
          await tx.execute(sql`SELECT id FROM agents WHERE id = ${input.agentId} FOR UPDATE`);
          const agentCredit = await agentsRepo.getCreditFields(input.agentId, tx);
          if (!agentCredit) {
            throw new Error('Agent credit information not found');
          }
          
          // Use the locked balance value (may differ from initial check due to race conditions)
          const lockedPreviousBalance = agentCredit.settlementBalance;
          const lockedSettlementAmount = Math.abs(lockedPreviousBalance);
          
          // Validate that locked balance is non-zero (may have changed due to concurrent operations)
          if (lockedSettlementAmount === 0) {
            throw new Error('Cannot settle CREDIT agent with zero settlement balance. Balance may have been settled by another process.');
          }
          
          const lockedDirection = lockedPreviousBalance >= 0 ? 'TO_AGENT' : 'FROM_AGENT';

          // Reset agent's settlementBalance to 0 after settlement (including all domain-specific balances)
          const newAgentSettlementBalance = 0;
          const newAgentSettlementBalanceSports = 0;
          const newAgentSettlementBalanceCasino = 0;
          const newAgentSettlementBalanceMatka = 0;
          const agentCreditAvailableBefore = Math.max(0, agentCredit.creditLimit - agentCredit.creditUsed + lockedPreviousBalance);
          const newAgentCreditAvailable = Math.max(0, agentCredit.creditLimit - agentCredit.creditUsed + newAgentSettlementBalance);
          // Filled in below when the balance cascades into a CREDIT parent, so the
          // parent's change is ledgered too.
          let parentLedgerChange: { parentId: string; delta: number; availableBefore: number; availableAfter: number } | null = null;

          await agentsRepo.lockAndUpdateCredit(input.agentId, {
            settlementBalance: newAgentSettlementBalance,
            settlementBalanceSports: newAgentSettlementBalanceSports,
            settlementBalanceCasino: newAgentSettlementBalanceCasino,
            settlementBalanceMatka: newAgentSettlementBalanceMatka,
            creditAvailable: newAgentCreditAvailable,
          }, tx);
          
          // Cascade to parent agent if exists and is also CREDIT type
          // Only CREDIT agents have settlementBalance fields, so we only cascade to CREDIT parents
          if (agent.parentAgentId) {
            // Get parent agent to check scheme type (inside transaction to avoid race conditions)
            const parentAgent = await agentsRepo.findById(agent.parentAgentId);
            if (parentAgent && parentAgent.schemeType === 'CREDIT') {
              // Same race one level up, and worse: the new parent balance is
              // computed here and written as an absolute value, so two children
              // settling into one parent lose an update outright. Locks are taken
              // child-then-parent everywhere, so the order is consistent and two
              // siblings cannot deadlock against each other.
              await tx.execute(sql`SELECT id FROM agents WHERE id = ${agent.parentAgentId} FOR UPDATE`);
              const parentCredit = await agentsRepo.getCreditFields(agent.parentAgentId, tx);
              if (parentCredit) {
                // Add this agent's domain-specific settlement balances to parent's domain-specific balances
                const newParentSettlementBalanceSports = parentCredit.settlementBalanceSports + agentCredit.settlementBalanceSports;
                const newParentSettlementBalanceCasino = parentCredit.settlementBalanceCasino + agentCredit.settlementBalanceCasino;
                const newParentSettlementBalanceMatka = parentCredit.settlementBalanceMatka + agentCredit.settlementBalanceMatka;
                const newParentSettlementBalance = newParentSettlementBalanceSports + newParentSettlementBalanceCasino + newParentSettlementBalanceMatka;
                const newParentCreditAvailable = Math.max(0, parentCredit.creditLimit - parentCredit.creditUsed + newParentSettlementBalance);
                
                await agentsRepo.lockAndUpdateCredit(agent.parentAgentId, {
                  settlementBalance: newParentSettlementBalance,
                  settlementBalanceSports: newParentSettlementBalanceSports,
                  settlementBalanceCasino: newParentSettlementBalanceCasino,
                  settlementBalanceMatka: newParentSettlementBalanceMatka,
                  creditAvailable: newParentCreditAvailable,
                }, tx);
                parentLedgerChange = {
                  parentId: agent.parentAgentId,
                  delta: newParentSettlementBalance - parentCredit.settlementBalance,
                  availableBefore: Math.max(0, parentCredit.creditLimit - parentCredit.creditUsed + parentCredit.settlementBalance),
                  availableAfter: newParentCreditAvailable,
                };
              }
            }
            // If parent is SHARING or COMMISSION, we don't cascade settlement balances
            // Those agents use different settlement mechanisms
          }

          // Update values to use locked amounts
          previousBalance = lockedPreviousBalance;
          settlementAmount = lockedSettlementAmount;
          calculatedDirection = lockedDirection;

          // CRITICAL FIX: Also create record in agent_settlements table for history
          // This ensures CREDIT agent settlements appear in the Settlement History tab
          const { AgentSettlementsRepo: AgentSettlementsRepoForHistory } = await import('../../../repos/agents/AgentSettlementsRepo.js');
          const settlementsRepoForHistory = new AgentSettlementsRepoForHistory();
          const now = new Date();
          const settledByAgentIdForCredit = (ctx?.user?.type === 'agent' && ctx?.user?.agentId) ? ctx.user.agentId : null;
          // Create agent_settlements record for CREDIT agents (same as SHARING agents)
          // For CREDIT, periodFrom and periodTo are the same (instant settlement, not period-based)
          settlementRecord = await settlementsRepoForHistory.open({
            agentId: input.agentId,
            periodFrom: now,
            periodTo: now,
            totalAmount: lockedDirection === 'FROM_AGENT' ? -lockedSettlementAmount : lockedSettlementAmount,
            currency,
            settledByAgentId: settledByAgentIdForCredit,
          }, tx);
          
          // Mark as POSTED immediately (CREDIT settlements are instant, not pending approval)
          await settlementsRepoForHistory.post({
            settlementId: settlementRecord.id,
            postedBy: settledByUuid,
          }, tx);

          // The transaction record (agent_settlement_transactions) and the
          // credit-ledger rows are written in this same transaction. The record
          // used to be written after the commit with its failure swallowed, and
          // no credit-ledger row was written at all, so a CREDIT settlement moved
          // balances that the agent's credit history never showed. Now the
          // balances, the history row, the record and the ledger commit or roll
          // back together.
          const settlementTransactionsRepo = new AgentSettlementTransactionsRepo();
          settlement = await settlementTransactionsRepo.create({
            tenant,
            agentId: input.agentId,
            settlementType: input.settlementType,
            amount: lockedSettlementAmount,
            direction: lockedDirection,
            previousBalance: lockedPreviousBalance,
            newBalance,
            notes: input.notes,
            settledBy: settledByUuid || undefined,
          }, tx);

          // Ledgered like every other agent credit change (ADJUSTMENT, with
          // balanceBefore/After = the entity's creditAvailable). The reason names
          // a settlement, which is what AgentCreditLedgerRepo.getSettlementsByEntity
          // matches on, and settlementId links the agent_settlements row.
          const { AgentCreditLedgerRepo } = await import('@/repos/agents/AgentCreditLedgerRepo.js');
          const creditLedgerRepo = new AgentCreditLedgerRepo();
          const createdByType: 'agent' | 'admin' = ctx?.user?.type === 'agent' ? 'agent' : 'admin';
          const counterpartyIsParent = parentLedgerChange !== null;
          await creditLedgerRepo.recordTransaction({
            tenantId: agent.tenantId,
            fromEntityType: counterpartyIsParent ? 'agent' : 'whitelabel',
            fromEntityId: counterpartyIsParent ? String(agent.parentAgentId) : agent.tenantId,
            toEntityType: 'agent',
            toEntityId: input.agentId,
            transactionType: 'ADJUSTMENT',
            amount: lockedSettlementAmount,
            currency,
            balanceBefore: agentCreditAvailableBefore,
            balanceAfter: newAgentCreditAvailable,
            reason: `Credit settlement (${lockedDirection === 'TO_AGENT' ? 'paid to agent' : 'collected from agent'}): settlement balance ${lockedPreviousBalance.toFixed(2)} → 0.00`,
            settlementId: settlementRecord.id,
            createdBy: settledByUuid ?? undefined,
            createdByType,
            metadata: {
              kind: 'AGENT_CREDIT_SETTLEMENT',
              settlementId: settlementRecord.id,
              settlementTransactionId: settlement?.id ?? null,
              direction: lockedDirection,
              settlementBalanceBefore: lockedPreviousBalance,
              settlementBalanceAfter: 0,
              settledByAgentId: settledByAgentIdForCredit,
            },
          }, tx);
          if (parentLedgerChange) {
            const change = parentLedgerChange as { parentId: string; delta: number; availableBefore: number; availableAfter: number };
            await creditLedgerRepo.recordTransaction({
              tenantId: agent.tenantId,
              fromEntityType: 'agent',
              fromEntityId: input.agentId,
              toEntityType: 'agent',
              toEntityId: change.parentId,
              transactionType: 'ADJUSTMENT',
              amount: Math.abs(change.delta),
              currency,
              balanceBefore: change.availableBefore,
              balanceAfter: change.availableAfter,
              reason: `Credit settlement of sub-agent ${input.agentId}: its settlement balance of ${lockedPreviousBalance.toFixed(2)} moves up to this agent`,
              settlementId: settlementRecord.id,
              createdBy: settledByUuid ?? undefined,
              createdByType,
              metadata: {
                kind: 'AGENT_CREDIT_SETTLEMENT_CASCADE',
                settlementId: settlementRecord.id,
                childAgentId: input.agentId,
                settlementBalanceDelta: change.delta,
              },
            }, tx);
          }
        });
      } catch (error: any) {
        // Transaction failed - return error
        return {
          success: false,
          message: error?.message || 'Failed to update settlement balances. Transaction rolled back.',
          settlement: null,
        };
      }
    } else {
      // This path should never be reached for SHARING agents with P_L settlement type
      // (they return early at line 286). This is only for edge cases or future settlement types.
      // For now, return an error if we reach here for SHARING agents.
      if ((agent.schemeType as string) === 'SHARING') {
        return {
          success: false,
          message: 'SHARING agent settlements must use the period-based flow. This error should not occur - please contact support.',
          settlement: null,
        };
      }
      
      // For other agent types (should not happen, but handle gracefully)
      const settlementsRepo = new AgentSettlementTransactionsRepo();
      settlement = await settlementsRepo.create({
        tenant,
        agentId: input.agentId,
        settlementType: input.settlementType,
        amount: settlementAmount,
        direction: calculatedDirection,
        previousBalance,
        newBalance,
        notes: input.notes,
        settledBy: settledByUuid || undefined,
      });
    }
    
    // Settlement is recorded in agent_settlements table
    // Ledger updates can be handled separately if needed
    
    // Ensure settlement record was created (for non-CREDIT agents)
    // For CREDIT agents, the main settlement succeeded even if transaction record failed
    if (!settlement && agent.schemeType !== 'CREDIT') {
      return {
        success: false,
        message: 'Failed to create settlement record',
        settlement: null,
      };
    }
    
    // Get agent details for response
    const { agentCredentials } = await import('@shared/db/schema/agents');
    const [credential] = await db
      .select()
      .from(agentCredentials)
      .where(eq(agentCredentials.agentId, input.agentId))
      .limit(1);
    
    // Build settlement response
    // For CREDIT agents, if transaction record failed but main settlement succeeded, create minimal response
    const settlementResponse = settlement ? {
      ...settlement,
      agent: {
        id: agent.id,
        username: credential?.username || null,
        schemeType: agent.schemeType,
      },
      createdAt: settlement.createdAt.toISOString(),
    } : (agent.schemeType === 'CREDIT' ? {
      id: null, // Transaction record not created
      tenant,
      agentId: input.agentId,
      settlementType: input.settlementType,
      amount: settlementAmount,
      direction: calculatedDirection,
      previousBalance,
      newBalance,
      notes: input.notes,
      agent: {
        id: agent.id,
        username: credential?.username || null,
        schemeType: agent.schemeType,
      },
      createdAt: new Date().toISOString(),
    } : null);
    
  return {
    success: true,
    message: 'Settlement completed successfully',
    settlement: {
      ...settlementResponse,
    },
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

  adjustPlayerCredit: async (_: any, args: any, ctx: any) => {
    ensureAgentCanMutate(ctx)
    requireAny(ctx, PLAYER_CREDIT, 'adjust player credit')
    // CRITICAL: For Director Admin, use effective tenant based on mode
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default');
    const userId = ctx?.user?.sub || ctx?.user?.id; // JWT payload uses 'sub', fallback to 'id'
    
    if (!userId) {
      return {
        success: false,
        message: 'Unauthorized: User ID required',
        adjustment: null,
      };
    }
    
    const { input } = args;
    
    // Validate input
    if (!input.playerId || !input.adjustmentType || !input.amount) {
      return {
        success: false,
        message: 'Missing required fields: playerId, adjustmentType, and amount are required',
        adjustment: null,
      };
    }
    
    if (input.amount <= 0) {
      return {
        success: false,
        message: 'Adjustment amount must be greater than 0',
        adjustment: null,
      };
    }
    if (input.amount > MAX_FINANCIAL_AMOUNT) {
      return {
        success: false,
        message: `Adjustment amount cannot exceed ${MAX_FINANCIAL_AMOUNT.toLocaleString()}`,
        adjustment: null,
      };
    }
    
    // Verify player exists first
    const [player] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, input.playerId), eq(users.tenant, tenant)))
      .limit(1);
    
    if (!player) {
      return {
        success: false,
        message: 'Player not found',
        adjustment: null,
      };
    }
    
    const isWhitelabelCredit = player.playerType === 'WHITELABEL_CREDIT'
    const isAgentCredit = player.playerType === 'AGENT_CREDIT'
    
    // Check if logged-in agent can adjust this player's credit
    let canAdjustCredit = false
    
    if (isWhitelabelCredit) {
      // WHITELABEL_CREDIT players draw on the whitelabel's own credit pool, so
      // they are admin-only. This branch said "by admins" but set the flag for
      // every caller, so any agent holding agents:manage could move a
      // whitelabel credit player's limit (and the whitelabel pool with it).
      if (ctx?.user?.type === 'agent') {
        return {
          success: false,
          message: 'Only an admin can adjust credit for a whitelabel credit player.',
          adjustment: null,
        };
      }
      canAdjustCredit = true
    } else if (isAgentCredit && ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      // AGENT_CREDIT players can be adjusted if logged-in agent is the player's agent
      const loggedInAgentId = ctx.user.agentId
      const playerAgentId = player.agentId
      
      if (loggedInAgentId === playerAgentId) {
        // Check if logged-in agent is a CREDIT agent (not SHARING)
        const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
        const agentsRepo = new AgentsRepo()
        const loggedInAgent = await agentsRepo.findById(loggedInAgentId)
        
        // Block SHARING and COMMISSION agents from adjusting player credit
        if (loggedInAgent?.schemeType === 'SHARING') {
          return {
            success: false,
            message: 'Sharing agents cannot adjust player credit',
            adjustment: null,
          }
        }
        
        if (loggedInAgent?.schemeType === 'COMMISSION') {
          return {
            success: false,
            message: 'Commission agents cannot adjust player credit. Commission agents are standalone and do not manage player credit.',
            adjustment: null,
          }
        }
        
        if (loggedInAgent?.schemeType === 'CREDIT') {
          canAdjustCredit = true
        }
      }
    }
    
    if (!canAdjustCredit) {
      if (isAgentCredit) {
        return {
          success: false,
          message: 'Credit adjustments for AGENT_CREDIT players are only available when you are the player\'s agent',
          adjustment: null,
        };
      } else {
        return {
          success: false,
          message: 'Only WHITELABEL_CREDIT players or AGENT_CREDIT players managed by you can have credit adjustments',
          adjustment: null,
        };
      }
    }
    
    // Get current credit values.
    //
    // Plan W7: these come from the plain read above and are used for friendly early
    // errors only. Every write below re-reads the player under its FOR UPDATE lock and
    // computes from that row (increments or values derived from the locked row), so a
    // bet settling or another adjustment landing in between is never erased.
    //
    // A settlement is its own explicit type (SETTLE). A DECREASE whose amount happens to
    // equal |settlement balance| is a DECREASE: it used to be silently turned into a
    // settlement, wiping the player's settlement balances instead of lowering credit_used.
    if (!isPlayerCreditAdjustmentType(input.adjustmentType)) {
      return {
        success: false,
        message: `Unknown adjustment type: ${input.adjustmentType}. Use INCREASE, DECREASE, LIMIT_CHANGE or SETTLE.`,
        adjustment: null,
      };
    }
    const plainReadLimit = Number(player.creditLimit || 0);
    let previousLimit = plainReadLimit;
    let previousUsed = Number(player.creditUsed || 0);
    let previousSettlementBalance = Number(player.settlementBalance || 0);
    // Calculate balanceBefore using new formula: creditLimit - creditUsed + settlementBalance
    let balanceBefore = Math.max(0, previousLimit - previousUsed + previousSettlementBalance);

    // Friendly pre-checks (re-checked under the lock below).
    if (input.adjustmentType === 'INCREASE' && previousUsed + input.amount > previousLimit) {
      return {
        success: false,
        message: `Increasing credit by ${input.amount} would exceed the credit limit of ${previousLimit}. Maximum increase allowed: ${Math.max(0, previousLimit - previousUsed)}`,
        adjustment: null,
      };
    }
    if (input.adjustmentType === 'DECREASE' && input.amount > previousUsed) {
      return {
        success: false,
        message: `Decrease amount cannot be greater than current used credit (${previousUsed})`,
        adjustment: null,
      };
    }
    if (input.adjustmentType === 'LIMIT_CHANGE' && input.amount < previousUsed) {
      return {
        success: false,
        message: `Credit limit cannot be less than current used credit (${previousUsed})`,
        adjustment: null,
      };
    }
    if (input.adjustmentType === 'SETTLE' && previousSettlementBalance === 0) {
      return {
        success: false,
        message: 'No settlement balance to settle. Settlement balance is already zero.',
        adjustment: null,
      };
    }

    let newLimit = previousLimit;
    let newUsed = previousUsed;
    let newSettlementBalance = previousSettlementBalance;

    // Variables to store entity balances before updates (for ledger transactions)
    let agentBalanceBefore: number | null = null;
    let agentBalanceAfter: number | null = null;
    let whitelabelBalanceBefore: number | null = null;
    let whitelabelBalanceAfter: number | null = null;
    let whitelabelCreditWasModified = false; // Track if whitelabel credit was modified
    let agentCreditWasModified = false;
    // SETTLE only: the domain balances that were settled (for the ledger rows).
    let settledBalances: { sports: number; casino: number; matka: number; total: number } | null = null;

    const creditAgentsRepo = new AgentsRepo();
    const { AgentPlayerCreditsRepo } = await import('@/repos/agents/AgentPlayerCreditsRepo.js');
    const apcRepo = new AgentPlayerCreditsRepo();
    const playerIdNum = Number(input.playerId);
    const readWhitelabelAvailable = async (tx: any): Promise<number | null> => {
      const r = await tx.execute(sql`
        SELECT credit_limit, credit_used, settlement_balance
        FROM whitelabels WHERE id = ${tenant} FOR UPDATE
      `)
      const w: any = (r as any).rows?.[0] ?? (r as any)[0] ?? null
      return w
        ? creditAvailableOf({ creditLimit: Number(w.credit_limit ?? 0), creditUsed: Number(w.credit_used ?? 0), settlementBalance: Number(w.settlement_balance ?? 0) })
        : null
    }

    try {
      await db.transaction(async (tx) => {
        // Lock the player row first: bet placement and settlement take their locks in
        // (player → agent → agent_player_credits) order, and so does every branch here.
        const locked = await lockPlayerCreditRow(tx, playerIdNum, tenant)
        if (!locked) {
          throw new Error('Player not found')
        }
        if (locked.playerType !== player.playerType || (locked.agentId ?? null) !== (player.agentId ?? null)) {
          throw new Error('The player\'s credit owner changed while this adjustment was being made. Reload and try again.')
        }
        previousLimit = locked.creditLimit
        previousUsed = locked.creditUsed
        previousSettlementBalance = locked.settlementBalance
        balanceBefore = creditAvailableOf(locked)
        newLimit = locked.creditLimit
        newUsed = locked.creditUsed
        newSettlementBalance = locked.settlementBalance
        const agentId = isAgentCredit ? locked.agentId : null

        if (input.adjustmentType === 'LIMIT_CHANGE') {
          // Confirm the limit this change was computed from is still the limit (W3): the
          // agent's credit / the whitelabel pool move by the delta, so a limit changed in
          // between must not be applied blindly.
          if (Math.abs(locked.creditLimit - plainReadLimit) > 0.001) {
            throw new Error('The player\'s credit limit changed while this adjustment was being made. Reload and try again.')
          }
          if (input.amount < locked.creditUsed) {
            throw new Error(`Credit limit cannot be less than current used credit (${locked.creditUsed})`)
          }
          const limitDelta = Math.round((input.amount - locked.creditLimit) * 100) / 100
          if (limitDelta === 0) return

          if (agentId) {
            // AGENT_CREDIT: the agent's credit_used moves by the delta (its credit_used is
            // the limits it handed down), validated under the agent row's lock.
            const agentLocked = await lockAgentCreditRow(tx, agentId)
            if (!agentLocked) {
              throw new Error('Agent credit information not found')
            }
            agentBalanceBefore = creditAvailableOf(agentLocked)
            if (limitDelta > 0 && limitDelta > agentBalanceBefore) {
              throw new Error(
                `Insufficient credit available. You have ${agentBalanceBefore.toFixed(2)} available, but ${limitDelta.toFixed(2)} is needed to increase the player's credit limit.`
              )
            }
            const agentAfter = await creditAgentsRepo.lockAndUpdateCredit(agentId, {
              creditUsedDelta: limitDelta,
              requireAvailableForDelta: limitDelta > 0,
            }, tx)
            agentBalanceAfter = agentAfter.creditAvailable
            agentCreditWasModified = true
          } else if (isWhitelabelCredit && shouldMoveWhitelabelPool(tenant, 'whitelabel_player')) {
            // WHITELABEL_CREDIT: the whitelabel pool moves by the delta (owner decision 2).
            // deductCredit / addCredit lock the whitelabel row and write their own
            // USAGE / RELEASE ledger rows; both run in this transaction.
            const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js');
            const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
            const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo());
            whitelabelBalanceBefore = await readWhitelabelAvailable(tx)
            if (whitelabelBalanceBefore === null) {
              throw new Error(`Whitelabel not found: ${tenant}`)
            }
            if (limitDelta > 0) {
              if (limitDelta > whitelabelBalanceBefore) {
                throw new Error(
                  `Insufficient whitelabel credit. Available: ${whitelabelBalanceBefore.toFixed(2)}, Requested: ${limitDelta.toFixed(2)}`
                )
              }
              await whitelabelCreditService.deductCredit(
                tenant,
                limitDelta,
                `WHITELABEL_CREDIT player limit increased - Player ID: ${input.playerId}, Limit: ${locked.creditLimit} → ${input.amount}`,
                tx
              )
            } else {
              await whitelabelCreditService.addCredit(
                tenant,
                Math.abs(limitDelta),
                `WHITELABEL_CREDIT player limit decreased - Player ID: ${input.playerId}, Limit: ${locked.creditLimit} → ${input.amount}`,
                tx
              )
            }
            whitelabelBalanceAfter = await readWhitelabelAvailable(tx)
            whitelabelCreditWasModified = true
          }

          // The player's limit moves by the delta (one SQL increment); credit_used and the
          // settlement balances are left exactly as the locked row has them.
          const after = await applyPlayerCreditLimitDelta(tx, playerIdNum, tenant, limitDelta)
          newLimit = after.creditLimit
          newUsed = after.creditUsed
          newSettlementBalance = after.settlementBalance

          // Keep agent_player_credits in step (the agent's Credit tab reads it).
          if (agentId) {
            await apcRepo.upsertFromPlayer({
              agentId,
              playerId: playerIdNum,
              creditLimit: after.creditLimit,
              creditUsed: after.creditUsed,
              settlementBalance: after.settlementBalance,
            }, tx)
          }
          return
        }

        if (input.adjustmentType === 'INCREASE' || input.adjustmentType === 'DECREASE') {
          if (input.adjustmentType === 'INCREASE' && locked.creditUsed + input.amount > locked.creditLimit) {
            throw new Error(
              `Increasing credit by ${input.amount} would exceed the credit limit of ${locked.creditLimit}. Maximum increase allowed: ${Math.max(0, locked.creditLimit - locked.creditUsed)}`
            )
          }
          if (input.adjustmentType === 'DECREASE' && input.amount > locked.creditUsed) {
            throw new Error(`Decrease amount cannot be greater than current used credit (${locked.creditUsed})`)
          }
          const usedDelta = input.adjustmentType === 'INCREASE' ? input.amount : -input.amount
          // credit_used moves by the delta, computed by Postgres from the locked row; the
          // settlement balances are untouched.
          const r = await tx.execute(sql`
            UPDATE users
            SET credit_used = GREATEST(0, COALESCE(credit_used, 0) + ${usedDelta}),
                credit_available = GREATEST(0, COALESCE(credit_limit, 0) - GREATEST(0, COALESCE(credit_used, 0) + ${usedDelta}) + COALESCE(settlement_balance, 0))
            WHERE id = ${playerIdNum} AND tenant = ${tenant}
            RETURNING credit_limit, credit_used, settlement_balance
          `)
          const u: any = (r as any).rows?.[0] ?? (r as any)[0] ?? null
          if (!u) {
            throw new Error('Player not found')
          }
          newLimit = Number(u.credit_limit ?? 0)
          newUsed = Number(u.credit_used ?? 0)
          newSettlementBalance = Number(u.settlement_balance ?? 0)

          // agent_player_credits follows the player's credit_used on INCREASE / DECREASE
          // too (it used to be synced only on limit changes).
          if (agentId) {
            await apcRepo.upsertFromPlayer({
              agentId,
              playerId: playerIdNum,
              creditLimit: newLimit,
              creditUsed: newUsed,
              settlementBalance: newSettlementBalance,
            }, tx)
          }
          return
        }

        // SETTLE: the player's settlement balances go to 0 and the same amounts come off the
        // agent's (AGENT_CREDIT) or whitelabel's (WHITELABEL_CREDIT) domain balances.
        if (locked.settlementBalance === 0) {
          throw new Error('No settlement balance to settle. Settlement balance is already zero.')
        }
        if (Math.abs(input.amount - Math.abs(locked.settlementBalance)) >= 0.01) {
          throw new Error(
            `The settlement balance is ${locked.settlementBalance} now, not ${input.amount}. Reload and try again.`
          )
        }
        settledBalances = {
          sports: locked.settlementBalanceSports,
          casino: locked.settlementBalanceCasino,
          matka: locked.settlementBalanceMatka,
          total: locked.settlementBalance,
        }
        await tx.execute(sql`
          UPDATE users
          SET settlement_balance = 0,
              settlement_balance_sports = 0,
              settlement_balance_casino = 0,
              settlement_balance_matka = 0,
              credit_available = GREATEST(0, COALESCE(credit_limit, 0) - COALESCE(credit_used, 0))
          WHERE id = ${playerIdNum} AND tenant = ${tenant}
        `)
        newSettlementBalance = 0
        const reverse = {
          sports: -locked.settlementBalanceSports,
          casino: -locked.settlementBalanceCasino,
          matka: -locked.settlementBalanceMatka,
        }
        if (agentId) {
          const agentLocked = await lockAgentCreditRow(tx, agentId)
          if (agentLocked) {
            agentBalanceBefore = creditAvailableOf(agentLocked)
            const agentAfter = await applySettlementDeltas(tx, 'agents', agentId, reverse)
            agentBalanceAfter = agentAfter ? agentAfter.creditAvailable : agentBalanceBefore
            agentCreditWasModified = true
          }
          // The agent's view of this player: its current_balance comes off by the same amount.
          try {
            await apcRepo.updatePlayerBalance(agentId, playerIdNum, -locked.settlementBalance, 0, tx)
          } catch {
            // No agent_player_credits row for this player: nothing to keep in step.
          }
        } else if (isWhitelabelCredit && tenant && tenant !== 'default') {
          whitelabelBalanceBefore = await readWhitelabelAvailable(tx)
          const wlAfter = await applySettlementDeltas(tx, 'whitelabels', tenant, reverse)
          whitelabelBalanceAfter = wlAfter ? wlAfter.creditAvailable : whitelabelBalanceBefore
          whitelabelCreditWasModified = wlAfter !== null
        }
      })
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Credit adjustment failed',
        adjustment: null,
      };
    }

    // Credit alert check for the agent whose credit moved (best-effort, never throws).
    if (agentCreditWasModified && isAgentCredit && player.agentId) {
      await new CreditService(new AgentsRepo()).checkCreditAlerts(player.agentId)
    }

    // Note: Player credit update is now handled above based on player type
    
    // Create adjustment record
    const adjustmentsRepo = new PlayerCreditAdjustmentsRepo();
    // Convert userId to UUID format if needed, or set to null if invalid
    let adjustedByUuid: string | null = null;
    if (userId) {
      // Check if userId is already a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(userId)) {
        adjustedByUuid = userId;
      }
      // If not UUID, it might be a numeric ID - we'll store as null for now
      // TODO: In future, create a proper admin_users table with UUID primary keys
    }
    
    // Calculate balanceAfter using new formula: creditLimit - creditUsed + settlementBalance
    const balanceAfter = Math.max(0, newLimit - newUsed + newSettlementBalance);
    
    const adjustment = await adjustmentsRepo.create({
      tenant,
      playerId: input.playerId,
      adjustmentType: input.adjustmentType,
      amount: input.amount,
      previousLimit,
      newLimit,
      previousUsed,
      newUsed,
      notes: input.notes,
      adjustedBy: adjustedByUuid ?? undefined, // Pass UUID or undefined
      balanceBefore,
      balanceAfter,
    });
    
    // Create credit ledger transactions (with error handling - don't fail mutation if logging fails)
    const { AgentCreditLedgerRepo } = await import('@/repos/agents/AgentCreditLedgerRepo.js');
    const creditLedgerRepo = new AgentCreditLedgerRepo();
    
    // Get currency from app config
    const { getAppConfigDb } = await import('@src/repos/app-config/appConfigRepo.js');
    const appConfig = await getAppConfigDb(tenant);
    const currency = appConfig?.baseCurrency || appConfig?.currency || 'INR';
    
    // Determine source entity (whitelabel or agent)
    const fromEntityType = isWhitelabelCredit ? 'whitelabel' : (isAgentCredit && player.agentId ? 'agent' : 'whitelabel');
    const fromEntityId = isWhitelabelCredit ? tenant : (isAgentCredit && player.agentId ? player.agentId : tenant);
    
    // Create player-side transaction
    if (input.adjustmentType === 'LIMIT_CHANGE') {
      // CREDIT_LIMIT_ADJUSTMENT transaction
      try {
        await creditLedgerRepo.recordTransaction({
          tenantId: tenant,
          fromEntityType: fromEntityType as 'whitelabel' | 'agent',
          fromEntityId: fromEntityId,
          toEntityType: 'player',
          toEntityId: String(input.playerId),
          transactionType: 'CREDIT_LIMIT_ADJUSTMENT',
          amount: Math.abs(newLimit - previousLimit),
          currency,
          balanceBefore: previousLimit,
          balanceAfter: newLimit,
          reason: input.notes || `Credit limit adjustment: ${previousLimit} → ${newLimit}`,
          createdBy: adjustedByUuid ?? undefined,
          createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
          metadata: {
            adjustmentId: adjustment.id,
            adjustmentType: 'LIMIT_CHANGE',
          },
        });
      } catch (err) {
        // Don't fail mutation if logging fails - credit adjustment already succeeded
      }
      
      // Create entity-side transaction for LIMIT_CHANGE
      if (isWhitelabelCredit && whitelabelBalanceBefore !== null && whitelabelBalanceAfter !== null) {
        // Whitelabel-side transaction
        const limitDelta = newLimit - previousLimit;
        
        try {
          await creditLedgerRepo.recordTransaction({
            tenantId: tenant,
            fromEntityType: 'whitelabel',
            fromEntityId: tenant,
            toEntityType: 'whitelabel',
            toEntityId: tenant,
            transactionType: 'ADJUSTMENT',
            amount: Math.abs(limitDelta),
            currency,
            balanceBefore: whitelabelBalanceBefore,
            balanceAfter: whitelabelBalanceAfter,
            reason: `Player credit limit adjustment - Player ID: ${input.playerId}, Limit: ${previousLimit} → ${newLimit}`,
            createdBy: adjustedByUuid ?? undefined,
            createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
            metadata: {
              adjustmentId: adjustment.id,
              relatedPlayerId: String(input.playerId),
            },
          });
        } catch (err) {
          // Don't fail mutation if logging fails - credit adjustment already succeeded
        }
      } else if (isAgentCredit && player.agentId && agentBalanceBefore !== null && agentBalanceAfter !== null) {
        // Agent-side transaction
        const limitDelta = newLimit - previousLimit;
        
        try {
          await creditLedgerRepo.recordTransaction({
            tenantId: tenant,
            fromEntityType: 'agent',
            fromEntityId: player.agentId,
            toEntityType: 'agent',
            toEntityId: player.agentId,
            transactionType: 'ADJUSTMENT',
            amount: Math.abs(limitDelta),
            currency,
            balanceBefore: agentBalanceBefore,
            balanceAfter: agentBalanceAfter,
            reason: `Player credit limit adjustment - Player ID: ${input.playerId}, Limit: ${previousLimit} → ${newLimit}`,
            createdBy: adjustedByUuid ?? undefined,
            createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
            metadata: {
              adjustmentId: adjustment.id,
              relatedPlayerId: String(input.playerId),
            },
          });
        } catch (err) {
          // Don't fail mutation if logging fails - credit adjustment already succeeded
        }
      }
    } else if (input.adjustmentType === 'INCREASE') {
      // CREDIT_USED_INCREASE transaction
      // Use new formula: creditAvailable = creditLimit - creditUsed + settlementBalance
      const previousAvailable = Math.max(0, previousLimit - previousUsed + previousSettlementBalance);
      const newAvailable = Math.max(0, newLimit - newUsed + newSettlementBalance);
      
      try {
        await creditLedgerRepo.recordTransaction({
          tenantId: tenant,
          fromEntityType: fromEntityType as 'whitelabel' | 'agent',
          fromEntityId: fromEntityId,
          toEntityType: 'player',
          toEntityId: String(input.playerId),
          transactionType: 'CREDIT_USED_INCREASE',
          amount: input.amount,
          currency,
          balanceBefore: previousAvailable,
          balanceAfter: newAvailable,
          reason: input.notes || `Credit used increased by ${input.amount}`,
          createdBy: adjustedByUuid ?? undefined,
          createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
          metadata: {
            adjustmentId: adjustment.id,
            adjustmentType: 'INCREASE',
          },
        });
      } catch (err) {
        // Don't fail mutation if logging fails - credit adjustment already succeeded
      }
    } else if (input.adjustmentType === 'DECREASE') {
      // CREDIT_USED_DECREASE transaction
      // Use new formula: creditAvailable = creditLimit - creditUsed + settlementBalance
      const previousAvailable = Math.max(0, previousLimit - previousUsed + previousSettlementBalance);
      const newAvailable = Math.max(0, newLimit - newUsed + newSettlementBalance);
      
      try {
        await creditLedgerRepo.recordTransaction({
          tenantId: tenant,
          fromEntityType: fromEntityType as 'whitelabel' | 'agent',
          fromEntityId: fromEntityId,
          toEntityType: 'player',
          toEntityId: String(input.playerId),
          transactionType: 'CREDIT_USED_DECREASE',
          amount: input.amount,
          currency,
          balanceBefore: previousAvailable,
          balanceAfter: newAvailable,
          reason: input.notes || `Credit used decreased by ${input.amount}`,
          createdBy: adjustedByUuid ?? undefined,
          createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
          metadata: {
            adjustmentId: adjustment.id,
            adjustmentType: 'DECREASE',
          },
        });
      } catch (err) {
        // Don't fail mutation if logging fails - credit adjustment already succeeded
      }
    }
    
    // SETTLE ledger rows (plan W7). Settlements are ADJUSTMENT rows whose reason names the
    // settlement (the convention agent settlements use; getSettlementsByEntity reads them),
    // not CREDIT_USED_DECREASE: credit_used does not move on a settlement.
    const settledForLedger = settledBalances as unknown as { sports: number; casino: number; matka: number; total: number } | null;
    if (input.adjustmentType === 'SETTLE' && settledForLedger) {
      const settleMeta = {
        adjustmentId: adjustment.id,
        adjustmentType: 'SETTLE',
        settlementBalanceBefore: settledForLedger.total,
        settlementBalanceAfter: 0,
        settledSports: settledForLedger.sports,
        settledCasino: settledForLedger.casino,
        settledMatka: settledForLedger.matka,
      };
      try {
        await creditLedgerRepo.recordTransaction({
          tenantId: tenant,
          fromEntityType: fromEntityType as 'whitelabel' | 'agent',
          fromEntityId: fromEntityId,
          toEntityType: 'player',
          toEntityId: String(input.playerId),
          transactionType: 'ADJUSTMENT',
          amount: Math.abs(settledForLedger.total),
          currency,
          balanceBefore,
          balanceAfter,
          reason: `Player credit settlement: ${settledForLedger.total} → 0${input.notes ? ` (${input.notes})` : ''}`,
          createdBy: adjustedByUuid ?? undefined,
          createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
          metadata: settleMeta,
        });
      } catch (err) {
        // Don't fail mutation if logging fails - the settlement already succeeded
      }
      const entityBefore = isAgentCredit ? agentBalanceBefore : whitelabelBalanceBefore;
      const entityAfter = isAgentCredit ? agentBalanceAfter : whitelabelBalanceAfter;
      if (entityBefore !== null && entityAfter !== null) {
        try {
          await creditLedgerRepo.recordTransaction({
            tenantId: tenant,
            fromEntityType: fromEntityType as 'whitelabel' | 'agent',
            fromEntityId: fromEntityId,
            toEntityType: fromEntityType as 'whitelabel' | 'agent',
            toEntityId: fromEntityId,
            transactionType: 'ADJUSTMENT',
            amount: Math.abs(settledForLedger.total),
            currency,
            balanceBefore: entityBefore as number,
            balanceAfter: entityAfter as number,
            reason: `Player credit settlement cascaded - Player ID: ${input.playerId}, settlement ${settledForLedger.total} → 0`,
            createdBy: adjustedByUuid ?? undefined,
            createdByType: ctx?.user?.type === 'agent' ? 'agent' : 'admin',
            metadata: { ...settleMeta, relatedPlayerId: String(input.playerId) },
          });
        } catch (err) {
          // Don't fail mutation if logging fails - the settlement already succeeded
        }
      }
    }

    // Publish subscription events for real-time updates (after transaction completes)
    // Get logged-in agent ID and player's agent ID
    const loggedInAgentId = ctx?.user?.type === 'agent' ? ctx?.user?.agentId : null;
    const playerAgentId = isAgentCredit ? player.agentId : null;
    
    // Helper function to publish subscription for an agent
    const publishAgentCreditUpdate = async (agentId: string, label: string) => {
      if (!agentId || !ctx?.pubsub) return;
      
      try {
        const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js');
        const agentsRepo = new AgentsRepo();
        const agent = await agentsRepo.findById(agentId);
        
        if (agent && agent.schemeType === 'CREDIT') {
          const { CreditService } = await import('@src/domains/agents/services/CreditService.js');
          const creditService = new CreditService(agentsRepo); // Pass agentsRepo to constructor
          const updatedCredit = await creditService.getCreditAllocation(agentId);
          const topic = `AGENT_CREDIT_${agentId}`;
          
          // Publish subscription event (EXACT same pattern as sub-agent credit adjustment)
          ctx.pubsub.publish({
            topic,
            payload: { agentCreditUpdated: updatedCredit },
          }).catch((err: Error) => {
          });
        }
      } catch (err: any) {
        // Don't fail mutation if subscription fails
      }
    };
    
    // Publish for logged-in agent (if they are an agent) - ensures their top bar updates
    if (loggedInAgentId) {
      await publishAgentCreditUpdate(loggedInAgentId, 'logged-in agent');
    }
    
    // Publish for player's agent (if different from logged-in agent) - ensures player's agent's top bar updates
    if (playerAgentId && playerAgentId !== loggedInAgentId) {
      await publishAgentCreditUpdate(playerAgentId, 'player\'s agent');
    }
    
    // Publish whitelabel credit subscription when whitelabel credit is adjusted
    // This ensures top bar updates in real-time when whitelabel admin adjusts player credit
    // Use same effectiveWhitelabelId logic as subscription resolver to ensure topic matches
    const isWhitelabel = tenant && tenant !== 'default';
    if (whitelabelCreditWasModified && isWhitelabel && ctx?.pubsub) {
      try {
        const { WhitelabelCreditService } = await import('@src/domains/common/services/WhitelabelCreditService.js');
        const { WhitelabelCreditRepo } = await import('@src/repos/common/whitelabelCreditRepo.js');
        const whitelabelCreditService = new WhitelabelCreditService(new WhitelabelCreditRepo());
        
        // Use effectiveWhitelabelId (same logic as subscription resolver) to ensure topic matches
        const effectiveWhitelabelId = directorTenant ?? (ctx?.whitelabel?.id ?? tenant);
        const updatedCredit = await whitelabelCreditService.getCreditAllocation(effectiveWhitelabelId);
        const topic = `WHITELABEL_CREDIT_${effectiveWhitelabelId}`;
        
        // Map isNearThreshold to isNearLimit for GraphQL schema compatibility
        const whitelabelCreditInfo = {
          creditLimit: updatedCredit.creditLimit,
          creditUsed: updatedCredit.creditUsed,
          creditAvailable: updatedCredit.creditAvailable,
          creditAlertThreshold: updatedCredit.creditAlertThreshold,
          usagePercentage: Math.round(updatedCredit.usagePercentage * 100) / 100,
          isNearLimit: updatedCredit.isNearThreshold, // Map isNearThreshold to isNearLimit
        };
        
        ctx.pubsub.publish({
          topic,
          payload: { whitelabelCreditUpdated: whitelabelCreditInfo },
        }).catch((err: Error) => {
        });
      } catch (err: any) {
        // Don't fail mutation if subscription fails
      }
    }
    
    return {
      success: true,
      message: 'Credit adjustment completed successfully',
      adjustment: {
        ...adjustment,
        player: {
          id: String(player.id),
          name: player.name,
          username: player.username || null,
        },
        createdAt: adjustment.createdAt.toISOString(),
      },
    };
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
        if (!agent || agent.tenantId !== tenant || agent.schemeType === 'COMMISSION') {
          failedCount++;
          continue;
        }
        const settlementType = agent.schemeType === 'CREDIT' ? 'CREDIT' : 'P_L';
        const input = {
          agentId,
          settlementType,
          amount: 0, // full amount; executeSettleAgent computes for SHARING/CREDIT
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

