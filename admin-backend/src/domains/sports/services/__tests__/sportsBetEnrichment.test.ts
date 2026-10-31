import { after, afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parse, type FieldNode, type FragmentDefinitionNode } from 'graphql';
import { pool } from '@src/db/client.js';
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js';
import { AgentConfigsRepo } from '@src/repos/agents/AgentConfigsRepo.js';
import { readSportsBetEnrichment, sportsBetEnrichmentFields } from '../sportsBetEnrichment.js';

afterEach(() => mock.restoreAll());
after(async () => { await pool.end(); });
const at = new Date('2026-10-24T08:00:00Z');
const all = { users: true, agents: true };
const agent = (id: string, schemeType = 'COMMISSION', allowedDomains = ['sports'], username: string | null = id) => ({ id, username, phone: '12345', schemeType, allowedDomains });
type Query = { text: string; values: unknown[] };
function database(userRows: unknown[][], attributions: unknown[][] = []) {
  const queries: Query[] = [];
  mock.method(pool as any, 'query', async (config: { text: string }, values: unknown[]) => {
    queries.push({ text: config.text, values });
    if (config.text.includes('"referral_attributions"')) return { rows: attributions };
    if (config.text.includes('from "users"')) return { rows: userRows };
    throw new Error('Unexpected database read');
  });
  return queries;
}
function selection(source: string) {
  const document = parse(source);
  const operation = document.definitions.find(node => node.kind === 'OperationDefinition')!;
  const fragments = Object.fromEntries(document.definitions.filter((node): node is FragmentDefinitionNode => node.kind === 'FragmentDefinition').map(node => [node.name.value, node]));
  if (operation.kind !== 'OperationDefinition') throw new Error('Missing operation');
  return { fieldNodes: operation.selectionSet.selections as FieldNode[], fragments };
}

describe('sports bet enrichment demand', () => {
  it('avoids metadata reads for book/header-only selections, but retains full responses for direct callers', () => {
    assert.deepEqual(sportsBetEnrichmentFields(selection('{ sportsBets { id userId stake liability } }')), { users: false, agents: false });
    assert.deepEqual(sportsBetEnrichmentFields(), all);
  });
  it('recognizes aliases, named fragments and inline fragments without confusing nested fields', () => {
    assert.deepEqual(sportsBetEnrichmentFields(selection('{ sportsBets { aliasName:userName userFlags } }')), { users: true, agents: false });
    assert.deepEqual(sportsBetEnrichmentFields(selection('{ sportsBets { ...A } } fragment A on SportsBet { ...B } fragment B on SportsBet { ... on SportsBet { aliasAgent:agentInfo { agentName } } }')), all);
  });
});

describe('request-local sports bet enrichment', () => {
  it('loads repeated users in two batch reads and shares an in-flight agent/rate across different players', async () => {
    const queries = database([[1, 'First', 'one', null, 'a'], [2, '', 'two', [{ flag: 'WATCH' }], 'a']]);
    let agentReads = 0, rateReads = 0;
    mock.method(AgentsRepo.prototype, 'findById', async () => { agentReads++; await Promise.resolve(); return agent('a') as any; });
    mock.method(AgentConfigsRepo.prototype, 'getCommissionConfig', async (_id, domain, date) => { rateReads++; assert.equal(domain, 'sports'); assert.equal(date, at); return { commissionRate: '0.025' } as any; });
    const result = await readSportsBetEnrichment(Array.from({ length: 1000 }, (_, i) => i % 2 + 1), 'brand-a', all, at);
    assert.equal(queries.length, 2);
    assert.equal(agentReads, 1);
    assert.equal(rateReads, 1);
    assert.equal(result.get('1')?.agentInfo?.rate, 2.5);
    assert.equal(result.get('2')?.name, 'two');
    assert.deepEqual(result.get('2')?.flags, [{ flag: 'WATCH' }]);
    const attrs = queries.find(query => query.text.includes('"referral_attributions"'))!;
    assert.ok(attrs.values.includes('brand-a'));
    assert.doesNotMatch(attrs.text, /"status"\s*=/, 'enrichment retains the previous all-status attribution behavior');
    assert.equal(attrs.values.filter(value => typeof value === 'number').length, 2);
    const people = queries.find(query => query.text.includes('from "users"'))!;
    assert.doesNotMatch(people.text, /"password|"email|"token/, 'only displayed metadata is fetched');
  });

  it('user-name-only selections skip all referral, agent and rate work; header-only selections issue no enrichment queries', async () => {
    const queries = database([[1, 'Player', 'player', null, 'a']]);
    mock.method(AgentsRepo.prototype, 'findById', async () => { throw new Error('Agent lookup must not run'); });
    const result = await readSportsBetEnrichment([1], 'brand-a', { users: true, agents: false }, at);
    assert.equal(result.get('1')?.name, 'Player');
    assert.equal(result.get('1')?.agentInfo, null);
    assert.equal(queries.length, 1);
    await readSportsBetEnrichment([1], 'brand-a', { users: false, agents: false }, at);
    await readSportsBetEnrichment([], 'brand-a', all, at);
    assert.equal(queries.length, 1);
  });

  it('direct assignment wins over referral, and Sharing/Credit retain percentage conversion and the same rate clock', async () => {
    database([[1, 'Sharing', 'p1', null, 'sharing'], [2, 'Credit', 'p2', null, 'credit'], [9, 'Referrer', 'referrer', null, null]], [[1, 9]]);
    mock.method(AgentsRepo.prototype, 'findById', async id => agent(id, id === 'sharing' ? 'SHARING' : 'CREDIT') as any);
    const rates: string[] = [];
    mock.method(AgentConfigsRepo.prototype, 'getSharingConfig', async (id, domain, date) => { rates.push(id); assert.equal(domain, 'sports'); assert.equal(date, at); return { shareRate: id === 'sharing' ? '0.35' : '0.7' } as any; });
    let referralLookups = 0;
    mock.method(AgentsRepo.prototype, 'findByUsername', async () => { referralLookups++; return null; });
    const result = await readSportsBetEnrichment([1, 2], 'brand-a', all, at);
    assert.equal(result.get('1')?.agentInfo?.rate, 35);
    assert.equal(result.get('2')?.agentInfo?.rate, 70);
    assert.deepEqual(rates.sort(), ['credit', 'sharing']);
    assert.equal(referralLookups, 0);
  });

  it('falls back from an ineligible direct agent to a tenant-scoped referrer username once, with the original name fallback', async () => {
    database([[1, 'One', 'p1', null, 'casino'], [2, 'Two', 'p2', null, null], [9, 'Referrer', '  Partner  ', null, null]], [[1, 9], [2, 9]]);
    mock.method(AgentsRepo.prototype, 'findById', async () => agent('casino', 'COMMISSION', ['casino']) as any);
    let lookups = 0;
    mock.method(AgentsRepo.prototype, 'findByUsername', async (username, excluded, tx, tenant) => {
      lookups++; assert.equal(username, '  Partner  '); assert.equal(excluded, undefined); assert.equal(tx, undefined); assert.equal(tenant, 'brand-a');
      return agent('fallback', 'COMMISSION', ['sports'], null) as any;
    });
    mock.method(AgentConfigsRepo.prototype, 'getCommissionConfig', async () => null);
    const result = await readSportsBetEnrichment([1, 2], 'brand-a', all, at);
    assert.equal(lookups, 1);
    assert.deepEqual(result.get('1')?.agentInfo, { agentId: 'fallback', agentName: 'Agent fallback', schemeType: 'COMMISSION', rate: 0 });
    assert.deepEqual(result.get('2')?.agentInfo, result.get('1')?.agentInfo);
  });

  it('retains direct-agent phone fallback, missing-user fallback and null for failed agent/config reads', async () => {
    database([[1, '', '', null, 'phone'], [2, 'Two', 'two', null, 'broken']]);
    mock.method(AgentsRepo.prototype, 'findById', async id => agent(id, 'COMMISSION', ['sports'], null) as any);
    mock.method(AgentConfigsRepo.prototype, 'getCommissionConfig', async id => { if (id === 'broken') throw new Error('Rate unavailable'); return null; });
    const result = await readSportsBetEnrichment([1, 2, 404], 'brand-a', all, at);
    assert.equal(result.get('1')?.name, 'User 1');
    assert.equal(result.get('1')?.agentInfo?.agentName, '12345');
    assert.equal(result.get('1')?.agentInfo?.rate, 0);
    assert.equal(result.get('2')?.agentInfo, null);
    assert.deepEqual(result.get('404'), { name: 'User 404', flags: null, agentInfo: null });
  });

  it('does not widen referral attribution when all-tenants scope has no tenant', async () => {
    const queries = database([[1, 'Player', 'player', null, null]], [[1, 9]]);
    const result = await readSportsBetEnrichment([1], undefined, all, at);
    assert.equal(queries.length, 1);
    assert.equal(result.get('1')?.agentInfo, null);
  });

  it('uses fresh metadata on the next request rather than persisting financial values', async () => {
    database([[1, 'Player', 'player', null, 'a']]);
    mock.method(AgentsRepo.prototype, 'findById', async () => agent('a') as any);
    let rate = '0.02';
    mock.method(AgentConfigsRepo.prototype, 'getCommissionConfig', async () => ({ commissionRate: rate }) as any);
    assert.equal((await readSportsBetEnrichment([1], 'brand-a', all, at)).get('1')?.agentInfo?.rate, 2);
    rate = '0.03';
    assert.equal((await readSportsBetEnrichment([1], 'brand-a', all, at)).get('1')?.agentInfo?.rate, 3);
  });
});
