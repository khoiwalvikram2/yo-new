import assert from 'node:assert/strict'
import { test } from 'vitest'
import { tabsFor,tabFields,valuesForVisitedTabs,hydrateSettings } from './settingsModel'
test('all field variants and unvisited omission match the named legacy controls',()=>{
  assert.equal(tabsFor('sport').flatMap(t=>tabFields[t]).length+2,35)
  assert.equal(tabsFor('league').flatMap(t=>tabFields[t]).length,29)
  assert.equal(tabsFor('event').flatMap(t=>tabFields[t]).length+1,30)
  assert.deepEqual(valuesForVisitedTabs({exchangeMinStake:10,riskThreshold:80,cashoutActive:false},new Set(['stake']),'sport'),{exchangeMinStake:10,mode:'overwrite',tier:'default'})
  assert.deepEqual(valuesForVisitedTabs({exchangeMinStake:null,exchangeMaxStake:undefined},new Set(['stake']),'league'),{exchangeMinStake:null})
  assert.deepEqual(valuesForVisitedTabs({mode:'fill-empty',tier:'vip-1',exchangeMinStake:10},new Set(['stake']),'league'),{exchangeMinStake:10})
})
test('sport/event defaults and league limited hydration preserve original field semantics',()=>{
  const sport=hydrateSettings({exchangeDelay:null,riskLevel:null,cashoutActive:null,alertChannel:null},'sport')
  assert.equal(sport.exchangeDelay,undefined);assert.equal(sport.cashoutActive,false);assert.equal(sport.alertChannel,'email');assert.equal(sport.alertRateLimit,10)
  const league=hydrateSettings({exchangeMinStake:0,exchangeCommission:1.5,riskThreshold:80},'league')
  assert.equal(league.exchangeMinStake,0);assert.equal(league.exchangeCommission,1.5);assert.equal('riskThreshold' in league,false)
  const event=hydrateSettings({cashoutActive:true,exchangeCommission:3},'event');assert.equal('cashoutActive' in event,false);assert.equal('exchangeCommission' in event,false)
})
