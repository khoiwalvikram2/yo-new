import { test } from 'vitest';
import assert from 'node:assert/strict';
import { agentDirectionLabel, agentSettlementDomains, aggregateSettlementDomains, hasPendingAmount, settlementDirectionOf, settlerDirectionLabel, sharingDashboardSplit, sharingSettlePeriod } from './settlementModel';
test('API domain breakdown keeps the players\' P/L, derives the agent share from the rate (positive = the agent earns) and passes the platform cut through', () => {
  assert.deepEqual(agentSettlementDomains({ settlementBreakdownByDomain: [{ domain: 'sports', amount: -100, percentage: 100, cutAmount: 25, cutPercentage: 25 }] }), [{ key: 'sports', domain: 'Sports', pl: -100, share: 75, shareRate: 75, cutAmount: 25, cutPercentage: 25 }]);
  // The backend's agentShare and shareRate win over the derived figures; players winning makes the agent pay.
  assert.deepEqual(agentSettlementDomains({ settlementBreakdownByDomain: [{ domain: 'casino', amount: 200, percentage: 100, cutAmount: 120, cutPercentage: 60, shareRate: '40', agentShare: -80 }] }), [{ key: 'casino', domain: 'Casino', pl: 200, share: -80, shareRate: 40, cutAmount: 120, cutPercentage: 60 }]);
});
test('fallback domain fields keep the signed share, a non-negative platform cut, zero handling and the original filtering', () => {
  assert.deepEqual(agentSettlementDomains({ sportsPL: -100, sportsShare: 80, casinoPL: 0, casinoShare: 10, matkaPL: 0, matkaShare: 0 }), [{ key: 'sports', domain: 'Sports', pl: -100, share: 80, shareRate: 80, cutAmount: 20, cutPercentage: 20 }, { key: 'casino', domain: 'Casino', pl: 0, share: 10, shareRate: 0, cutAmount: 0, cutPercentage: 0 }]);
});
test('admin aggregate sums signed players\' P/L, agent share and platform cut per entry, keeps domain order and drops unknown domains', () => {
  const base = { agentId: 'a1', pendingAmount: 10, settlementType: 'P_L' };
  assert.deepEqual(aggregateSettlementDomains([{ ...base, settlementBreakdownByDomain: [{ domain: 'SPORTS', amount: -100, percentage: 50, cutAmount: 20, cutPercentage: 20, agentShare: 80 }, { domain: 'sports', amount: 50, percentage: 50, cutAmount: 10, cutPercentage: 20, agentShare: -40 }, { domain: 'unknown', amount: 500, percentage: 10, cutAmount: 100, cutPercentage: 20 }] }, { ...base, agentId: 'a2', settlementBreakdownByDomain: [{ domain: 'casino', amount: -30, percentage: 100, cutAmount: 30, cutPercentage: 100 }] }]), [
    { key: 'sports', domain: 'Sports', pl: -50, share: 40, cutAmount: 30, count: 2 },
    { key: 'casino', domain: 'Casino', pl: -30, share: 0, cutAmount: 30, count: 1 },
  ]);
});
test('settlement direction: the backend direction wins, else the sign (positive = TO_AGENT), and less than half a cent is NONE', () => {
  assert.equal(settlementDirectionOf('FROM_AGENT', 500), 'FROM_AGENT');
  assert.equal(settlementDirectionOf('TO_AGENT', -500), 'TO_AGENT');
  assert.equal(settlementDirectionOf(null, 500), 'TO_AGENT');
  assert.equal(settlementDirectionOf(undefined, 0.004), 'NONE');
  assert.equal(settlementDirectionOf(undefined, Number.NaN), 'NONE');
  assert.deepEqual((['TO_AGENT', 'FROM_AGENT', 'NONE'] as const).map(settlerDirectionLabel), ['Pay to agent', 'Collect from agent', 'Settled']);
  assert.deepEqual((['TO_AGENT', 'FROM_AGENT', 'NONE'] as const).map(agentDirectionLabel), ['You receive', 'You pay', 'Settled']);
});
test('pending exists at one cent either way', () => {
  for (const amount of [0.01, -0.01, 4000, -4000]) assert.equal(hasPendingAmount(amount), true);
  for (const amount of [0, 0.009, -0.009, null, undefined, Number.NaN]) assert.equal(hasPendingAmount(amount), false);
});
test('dashboard sharing split prefers the backend parts and falls back to the sign of the net', () => {
  assert.deepEqual(sharingDashboardSplit({ pendingSharingSettlements: -20, pendingSharingToAgents: 30, pendingSharingFromAgents: -50 }), { toAgents: 30, fromAgents: 50, net: -20 });
  assert.deepEqual(sharingDashboardSplit({ pendingSharingSettlements: -20 }), { toAgents: 0, fromAgents: 20, net: -20 });
  assert.deepEqual(sharingDashboardSplit({ pendingSharingSettlements: 15 }), { toAgents: 15, fromAgents: 0, net: 15 });
  assert.deepEqual(sharingDashboardSplit(null), { toAgents: 0, fromAgents: 0, net: 0 });
});
test('a SHARING settle carries the pending row\'s periodTo; CREDIT and rows without a window carry none', () => {
  assert.deepEqual(sharingSettlePeriod({ schemeType: 'SHARING', periodTo: '2026-10-09T10:00:00.000Z' }), { periodTo: '2026-10-09T10:00:00.000Z' });
  assert.deepEqual(sharingSettlePeriod({ agent: { schemeType: 'SHARING' }, periodTo: '2026-10-09T10:00:00.000Z' }), { periodTo: '2026-10-09T10:00:00.000Z' });
  assert.deepEqual(sharingSettlePeriod({ schemeType: 'CREDIT', periodTo: '2026-10-09T10:00:00.000Z' }), {});
  assert.deepEqual(sharingSettlePeriod({ schemeType: 'SHARING', periodTo: null }), {});
  assert.deepEqual(sharingSettlePeriod(null), {});
});
