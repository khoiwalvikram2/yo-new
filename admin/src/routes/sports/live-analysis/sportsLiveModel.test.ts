import { test } from 'vitest';
import assert from 'node:assert/strict';
import { orderedLiveRows, resolveSidebarMarket, resolveSidebarRunner, sidebarPotentialPayout, sidebarBetPnL, sidebarCut, type SidebarBet } from './sportsLiveModel';
const bet: SidebarBet = { id: 'bet1', userId: 'player1', marketId: 'market1', side: 'back', stake: 100, liability: 150, price: 2.5, status: 'matched' };
test('live snapshot sorting stays client-only, stable, non-mutating and direction-aware', () => {
  const rows = [{ id: 'a', value: 20 }, { id: 'b', value: 10 }];
  const columns = [{ key: 'value', header: 'Value', cell: (row: { value: number }) => row.value, sort: (a: { value: number }, b: { value: number }) => a.value - b.value }];
  assert.deepEqual(orderedLiveRows(rows, columns, { key: 'value', dir: 'asc' }).map(row => row.id), ['b', 'a']);
  assert.deepEqual(orderedLiveRows(rows, columns, { key: 'value', dir: 'desc' }).map(row => row.id), ['a', 'b']);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b']);
});
test('potential payout preserves exchange/bookmaker back/lay and Fancy odds-size calculation', () => {
  assert.equal(sidebarPotentialPayout(bet, {}), 150);
  assert.equal(sidebarPotentialPayout({ ...bet, side: 'lay' }, {}), 100);
  const markets = { market1: { id: 'market1', kind: 'fancy' } };
  assert.equal(sidebarPotentialPayout({ ...bet, oddsSize: 87 }, markets), 87);
  assert.equal(sidebarPotentialPayout({ ...bet, side: 'lay', oddsSize: 87 }, markets), 150);
  assert.equal(sidebarPotentialPayout({ ...bet, odds_size: 0 }, markets), 0);
});
test('settled player P&L preserves back/lay signs and void/cancelled neutral values', () => {
  assert.equal(sidebarBetPnL({ ...bet, status: 'won' }), 150);
  assert.equal(sidebarBetPnL({ ...bet, status: 'lost' }), -100);
  assert.equal(sidebarBetPnL({ ...bet, status: 'won', side: 'lay' }), 100);
  assert.equal(sidebarBetPnL({ ...bet, status: 'lost', side: 'lay' }), -150);
  for (const status of ['void', 'cancelled', 'matched', 'unmatched']) assert.equal(sidebarBetPnL({ ...bet, status }), 0);
});
test('commission cut applies only to positive settled platform P&L, never open or player-won bets', () => {
  const commission = { ...bet, agentInfo: { agentId: 'agent1', schemeType: 'COMMISSION', rate: 20 } };
  assert.equal(sidebarCut({ ...commission, status: 'lost', side: 'lay' }).cutAmount, 30);
  assert.equal(sidebarCut({ ...commission, status: 'lost' }).cutAmount, 20);
  assert.equal(sidebarCut({ ...commission, status: 'won' }).cutAmount, 0);
  assert.equal(sidebarCut(commission).cutAmount, 0);
});
test('sharing and credit preserve settled absolute P&L and open potential cut; gross/net formulas are unchanged', () => {
  for (const schemeType of ['SHARING', 'CREDIT']) {
    const sharing = { ...bet, agentInfo: { agentId: 'agent1', schemeType, rate: 20 } };
    assert.deepEqual(sidebarCut(sharing), { cutAmount: 30, cutPercentage: 20, grossPayout: 150, netPayout: 120 });
    assert.deepEqual(sidebarCut({ ...sharing, side: 'lay' }), { cutAmount: 20, cutPercentage: 20, grossPayout: 150, netPayout: 130 });
    assert.deepEqual(sidebarCut({ ...sharing, status: 'won' }), { cutAmount: 30, cutPercentage: 20, grossPayout: 150, netPayout: 120 });
    assert.equal(sidebarCut({ ...sharing, status: 'lost' }).cutAmount, 20);
  }
});
test('market and runner resolution retains numeric key and case-insensitive selection-code fallback', () => {
  const market = { id: 123, name: 'Match Odds' };
  assert.equal(resolveSidebarMarket({ '123': market }, '123'), market);
  assert.equal(resolveSidebarRunner([{ id: '10', selectionCode: 'TEAM-A', name: 'Team A' }], 'team-a'), 'Team A');
  assert.equal(resolveSidebarRunner([{ id: '10', runnerName: 'Team A' }], '10'), 'Team A');
  assert.equal(resolveSidebarRunner([], 'missing'), null);
});
