/**
 * Non-regression tests: COMMISSION uses payCommission only; SHARING uses settleAgent only; CREDIT uses
 * neither (its chips move by Deposit / Withdraw since 2026-11-02).
 * Run with: node --import tsx --test src/domains/settlements/__tests__/schemeIsolation.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SETTLE_AGENT_SCHEMES,
  PAY_COMMISSION_SCHEMES,
  CREDIT_MOVES_AS_CHIPS,
  usesSettleAgent,
  usesPayCommission,
  isCommissionOnly,
} from '../schemeIsolation.js';

describe('Scheme isolation contract', () => {
  it('COMMISSION is only in payCommission path, not in settleAgent', () => {
    assert.strictEqual(usesPayCommission('COMMISSION'), true);
    assert.strictEqual(usesSettleAgent('COMMISSION'), false);
    assert.strictEqual(isCommissionOnly('COMMISSION'), true);
  });

  it('SHARING uses settleAgent only; CREDIT uses neither settlement path', () => {
    assert.deepStrictEqual(SETTLE_AGENT_SCHEMES, ['SHARING']);
    assert.deepStrictEqual(PAY_COMMISSION_SCHEMES, ['COMMISSION']);
    assert.strictEqual(usesSettleAgent('SHARING'), true);
    assert.strictEqual(usesSettleAgent('CREDIT'), false);
    assert.strictEqual(usesPayCommission('SHARING'), false);
    assert.strictEqual(usesPayCommission('CREDIT'), false);
    assert.strictEqual(CREDIT_MOVES_AS_CHIPS, 'Credit now moves as chips: use Deposit / Withdraw');
  });

  it('resolver: settleAgent refuses a CREDIT agent with the chips message, whatever the settlement type', async () => {
    const { AgentsRepo } = await import('../../../repos/agents/AgentsRepo.js');
    const originalFindById = AgentsRepo.prototype.findById;
    const originalGetCreditFields = AgentsRepo.prototype.getCreditFields;
    (AgentsRepo.prototype as any).findById = async (id: string) => ({
      id,
      tenantId: 't1',
      schemeType: 'CREDIT' as const,
      status: 'ACTIVE',
      allowedDomains: ['sports'],
      phone: null,
      parentAgentId: null,
      levelIndex: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      username: 'credit1',
      tokenVersion: 0,
    });
    (AgentsRepo.prototype as any).getCreditFields = async () => {
      throw new Error('the retired settlement balance must not be read');
    };
    try {
      const { settlementsMutationResolvers } = await import('../resolvers/mutations.js');
      const ctx = { user: { sub: 'user-1' }, tenant: 't1', permissions: [{ domain: 'all', actions: ['*'] }] };
      for (const settlementType of ['CREDIT', 'P_L']) {
        const result = await (settlementsMutationResolvers as any).settleAgent(
          null,
          { input: { agentId: 'agent-1', settlementType, direction: 'TO_AGENT', amount: 0, notes: 'credit settle test' } },
          ctx
        );
        assert.strictEqual(result?.success, false);
        assert.strictEqual(result?.message, CREDIT_MOVES_AS_CHIPS);
        assert.strictEqual(result?.settlement, null);
      }
    } finally {
      AgentsRepo.prototype.findById = originalFindById;
      AgentsRepo.prototype.getCreditFields = originalGetCreditFields;
    }
  });

  it('resolver: settleAgent rejects COMMISSION agent with payCommission message', { skip: !process.env.DATABASE_URL }, async () => {
    const { AgentsRepo } = await import('../../../repos/agents/AgentsRepo.js');
    const originalFindById = AgentsRepo.prototype.findById.bind(AgentsRepo.prototype);
    (AgentsRepo.prototype as any).findById = async function (id: string) {
      return {
        id,
        tenantId: 't1',
        schemeType: 'COMMISSION' as const,
        status: 'ACTIVE',
        allowedDomains: ['sports'],
        phone: null,
        parentAgentId: null,
        levelIndex: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        username: 'agent1',
        tokenVersion: 0,
      };
    };
    try {
      const { settlementsMutationResolvers } = await import('../resolvers/mutations.js');
      const ctx = {
        user: { sub: 'user-1' },
        tenant: 't1',
        permissions: [{ domain: 'all', actions: ['*'] }],
      };
      const result = await (settlementsMutationResolvers as any).settleAgent(
        null,
        {
          input: {
            agentId: 'agent-1',
            settlementType: 'P_L',
            direction: 'CREDIT',
            amount: 100,
            notes: 'Test notes here',
          },
        },
        ctx
      );
      assert.strictEqual(result?.success, false);
      assert.ok(
        (result?.message ?? '').includes('payCommission') || (result?.message ?? '').includes('Commission agents cannot'),
        `Expected message to mention payCommission or commission; got: ${result?.message}`
      );
    } finally {
      AgentsRepo.prototype.findById = originalFindById;
    }
  });

  it('resolver: payCommission rejects non-COMMISSION agent', { skip: !process.env.DATABASE_URL }, async () => {
    const { AgentsRepo } = await import('../../../repos/agents/AgentsRepo.js');
    const originalFindById = AgentsRepo.prototype.findById.bind(AgentsRepo.prototype);
    (AgentsRepo.prototype as any).findById = async function (id: string) {
      return {
        id,
        tenantId: 't1',
        schemeType: 'SHARING' as const,
        status: 'ACTIVE',
        allowedDomains: ['sports'],
        phone: null,
        parentAgentId: null,
        levelIndex: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        username: 'agent1',
        tokenVersion: 0,
      };
    };
    try {
      const { settlementsMutationResolvers } = await import('../resolvers/mutations.js');
      const ctx = {
        user: { sub: 'user-1' },
        tenant: 't1',
        permissions: [{ domain: 'all', actions: ['*'] }],
      };
      const mondayFrom = '2025-03-03T00:00:00+05:30';
      const mondayTo = '2025-03-10T00:00:00+05:30';
      const result = await (settlementsMutationResolvers as any).payCommission(
        null,
        {
          input: {
            agentId: 'agent-1',
            amount: 100,
            notes: 'Test notes',
            periodFrom: mondayFrom,
            periodTo: mondayTo,
          },
        },
        ctx
      );
      assert.strictEqual(result?.success, false);
      assert.ok(
        (result?.message ?? '').includes('COMMISSION') && (result?.message ?? '').toLowerCase().includes('only'),
        `Expected message to say only COMMISSION agents; got: ${result?.message}`
      );
    } finally {
      AgentsRepo.prototype.findById = originalFindById;
    }
  });
});
