import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchema, graphql } from 'graphql';
import { selectedDashboardFields } from '../dashboardSelection.js';

const schema = buildSchema('type Query { overviewKPIs: OverviewKPIs! } type OverviewKPIs { activePlayers: Int! totalDeposits: Float! totalWithdrawals: Float! agentCommission: Float! }');
async function selected(query: string, variables = {}) {
  const calls: Array<string[]> = [];
  const answer = await graphql({ schema, source: query, variableValues: variables,
    rootValue: { overviewKPIs: (_args: unknown, _context: unknown, info: Parameters<typeof selectedDashboardFields>[0]) => {
      calls.push([...selectedDashboardFields(info)!].sort());
      return { activePlayers: 2, totalDeposits: 100, totalWithdrawals: 50, agentCommission: 25 };
    } } });
  assert.equal(answer.errors, undefined); return calls;
}
describe('Dashboard GraphQL selection', () => {
  it('uses actual names behind field aliases and collects named/inline fragments', async () => {
    assert.deepEqual(await selected('{ overviewKPIs { count: activePlayers ...Money ... on OverviewKPIs { totalWithdrawals } } } fragment Money on OverviewKPIs { amount: totalDeposits }'), [['activePlayers', 'totalDeposits', 'totalWithdrawals']]);
  });
  it('respects include/skip variables so an omitted expensive field does not force a full calculation', async () => {
    const query = 'query($hide: Boolean!, $money: Boolean!) { overviewKPIs { activePlayers agentCommission @skip(if: $hide) ...Money @include(if: $money) } } fragment Money on OverviewKPIs { totalDeposits }';
    assert.deepEqual(await selected(query, { hide: true, money: false }), [['activePlayers']]);
    assert.deepEqual(await selected(query, { hide: false, money: true }), [['activePlayers', 'agentCommission', 'totalDeposits']]);
  });
  it('includes every merged selection node for the same response field', async () => {
    assert.deepEqual(await selected('{ overviewKPIs { activePlayers } overviewKPIs { totalDeposits } }'), [['activePlayers', 'totalDeposits']]);
  });
  it('a typename-only selection needs no statistics, while missing GraphQL info retains the complete path', async () => {
    assert.deepEqual(await selected('{ overviewKPIs { __typename } }'), [[]]);
    assert.equal(selectedDashboardFields(), undefined);
  });
});
