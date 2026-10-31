/**
 * Non-regression tests: COMMISSION uses payCommission only; CREDIT/SHARING use settleAgent only.
 * Run with: node --import tsx --test src/domains/settlements/__tests__/schemeIsolation.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SETTLE_AGENT_SCHEMES,
  PAY_COMMISSION_SCHEMES,
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

  it('SHARING and CREDIT use settleAgent only, not payCommission', () => {
    assert.deepStrictEqual(SETTLE_AGENT_SCHEMES, ['SHARING', 'CREDIT']);
    assert.deepStrictEqual(PAY_COMMISSION_SCHEMES, ['COMMISSION']);
    assert.strictEqual(usesSettleAgent('SHARING'), true);
    assert.strictEqual(usesSettleAgent('CREDIT'), true);
    assert.strictEqual(usesPayCommission('SHARING'), false);
    assert.strictEqual(usesPayCommission('CREDIT'), false);
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
