import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import type { BookEntry } from '../utils/bookCalculator'
import { fancyRunnerHasBets, formatOddsVolume, matchOddsData, standardOddsData, totalWithCutForEntries, type CutViewer } from './marketOddsModel'

describe('market odds contract parity', () => {
  test('retains zero/invalid volumes and original rounded K/M abbreviations', () => {
    assert.deepEqual([undefined, null, 0, 'bad', 50.6, 1250, 1800, 1500000].map(formatOddsVolume), ['0', '0', '0', '0', '51', '1K', '2K', '1.5M'])
  })
  test('standard markets keep maximum back/minimum lay and their corresponding sizes', () => {
    assert.deepEqual(standardOddsData({ ex: { availableToBack: [{ price: 2, size: 10 }, { price: 3, size: 20 }], availableToLay: [{ price: 5, size: 40 }, { price: 4, size: 30 }] } }), { back: 3, backSize: 20, lay: 4, laySize: 30 })
    assert.deepEqual(standardOddsData({ backPrice: '1.7', layPrice: '1.9', backSize: 0, volume: 80 }), { back: 1.7, backSize: 80, lay: 1.9, laySize: 80 })
    assert.equal(standardOddsData({ ex: { availableToBack: [], availableToLay: [{ price: 4 }] } }).lay, 0)
  })
  test('match depth keeps its existing first-three ascending prices and main-slot placement', () => {
    const result = matchOddsData({ back: 9, ex: { availableToBack: [{ price: 2.4, size: 30.6 }, { price: 2, size: 10.5 }, { price: 1.8, size: 9.4 }, { price: 2.2, size: 20 }], availableToLay: [{ price: 3.2 }, { price: 2.8 }, { price: 3 }, { price: 2.6 }] } }, true, false)
    assert.deepEqual(result.backOdds.map(odd => [odd.value, odd.volume, odd.isMain]), [[1.8, 9, false], [2, 11, false], [2.2, 20, true]])
    assert.deepEqual(result.layOdds.map(odd => [odd.value, odd.isMain]), [[2.6, true], [2.8, false], [3, false]])
  })
  test('match direct fallbacks and exchange loading/unavailable flags remain distinct', () => {
    const direct = matchOddsData({ backPrice: 2, layPrice: 3 }, true, false)
    assert.deepEqual(direct.backOdds.map(odd => odd.value), [0, 0, 2])
    assert.deepEqual(direct.layOdds.map(odd => odd.value), [3, 0, 0])
    assert.ok(matchOddsData({}, true, false).backOdds.every(odd => odd.isLoading))
    assert.ok(matchOddsData({}, true, true).backOdds.every(odd => !odd.isLoading))
    assert.equal(matchOddsData({}, false, false).backOdds.length, 1)
  })
  test('fancy detection retains merged IDs, all selection identifiers and normalized/long partial name matches', () => {
    const market = { id: 'merged', type: 'fancy', _dbMarketIds: ['db-1', 'db-2'] }
    const runner = { id: 'r1', selectionCode: 'code', name: 'First Innings Runs', _fancyLine: { id: 'line' } }
    for (const selectionId of ['r1', 'code', 'line']) assert.equal(fancyRunnerHasBets(runner, market, [{ marketId: 'db-2', selectionId, status: 'MATCHED' }]), true)
    assert.equal(fancyRunnerHasBets(runner, market, [{ marketId: 'db-1', selectionName: ' first   innings RUNS ', status: 'matched' }]), true)
    assert.equal(fancyRunnerHasBets(runner, market, [{ marketId: 'db-1', selectionName: 'Innings Runs', status: 'matched' }]), true)
    assert.equal(fancyRunnerHasBets(runner, market, [{ marketId: 'other', selectionId: 'line', status: 'matched' }]), false)
    assert.equal(fancyRunnerHasBets(runner, market, [{ marketId: 'db-1', selectionId: 'line', status: 'void' }]), false)
    assert.equal(fancyRunnerHasBets({ name: 'Runs' }, market, [{ marketId: 'db-1', selectionName: 'Runs extra', status: 'matched' }]), false)
  })
  test('cut totals retain rolled-agent differences, platform inversion, zero-rate fallback and clamping', () => {
    const entry: BookEntry = { userId: 'u', userName: 'U', grossProfit: 100, grossLoss: 0, netPL: 100, agentId: 'child', agentCut: 0, agentRate: 10 }
    const viewer: CutViewer = { isAgent: false, isWhitelabelAdmin: true, isSuperAdmin: false, isSuperAdminInWhitelabelMode: false, sharingRate: 70, viewContext: { directChildAgentIds: ['root'], getDescendantsOf: () => ['root', 'child'], getAgentInfo: () => ({ username: 'root', schemeType: 'SHARING', rate: 20 }) } }
    assert.equal(totalWithCutForEntries([entry], viewer), 50)
    assert.equal(totalWithCutForEntries([entry], { ...viewer, sharingRate: 5 }), 0)
    assert.equal(totalWithCutForEntries([entry], { ...viewer, isSuperAdmin: true }), -100)
    assert.equal(totalWithCutForEntries([{ ...entry, netPL: -100 }], { ...viewer, isSuperAdmin: true }), 100)
    assert.equal(totalWithCutForEntries([{ ...entry, agentId: undefined, agentRate: 0 }], { ...viewer, viewContext: null }), 70)
    assert.equal(totalWithCutForEntries([entry], { ...viewer, isWhitelabelAdmin: false, isAgent: true, agentId: 'root' }), 20)
    assert.equal(totalWithCutForEntries([entry], { ...viewer, viewContext: { ...viewer.viewContext!, getAgentInfo: () => ({ username: 'root', schemeType: 'COMMISSION', rate: 0 }) } }), 70)
  })
})
