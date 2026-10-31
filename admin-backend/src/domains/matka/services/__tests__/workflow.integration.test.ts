import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
const record = JSON.parse(fs.readFileSync('../tmp/matka-test-database-2026-10-25.json', 'utf8'))
const target = new URL(process.env.DATABASE_URL!)
assert.match(record.name, /^gw_matka_test_20261025_\d+$/); assert.notEqual(target.pathname, '/' + record.name)
target.pathname = '/' + record.name; process.env.DATABASE_URL = target.toString()
const { db, pool } = await import('@/db/client.js')
const tables = await import('@shared/db/schema.js')
const { createMatkaDb, updateMatkaDb, createRateVersionDb } = await import('@/repos/matka/matkaRepo.js')
const { createMatkaResult, rollbackMatkaResult } = await import('@/repos/matka/matkaResultsRepo.js')
const { ensureTodayWorliInstancesForActiveMatkas } = await import('@/domains/matka-worli/services/BootstrapService.js')
const { worliQueryResolvers } = await import('@/domains/matka-worli/resolvers/queries.js')
const { worliSubscriptionResolvers } = await import('@/domains/matka-worli/resolvers/subscriptions.js')
const { effectiveMatkaRates } = await import('@shared/matka/catalogue.js')
const { processScheduledResults } = await import('@/services/resultSchedulerService.js')
const tenant = 'matka-admin-qa-' + randomUUID().slice(0, 8)
test.before(async () => {
  assert.equal((await pool.query('SELECT current_database() name')).rows[0].name, record.name)
  assert.equal((await pool.query('SELECT marker FROM matka_workflow_test_marker')).rows[0].marker, record.marker)
  await db.insert(tables.whitelabels).values({ id: tenant, name: 'Isolated admin Matka QA', domain: tenant + '.invalid' })
})
test.after(async () => { await pool.end() })
const config = { name: 'Admin QA Market', code: 'qa-' + randomUUID().slice(0, 8), timezone: 'UTC', status: 'active' as const, schedule: { openTime: '23:58', closeTime: '23:59', daysOfWeek: [0,1,2,3,4,5,6] }, settings: { matkaType: 'worli', betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10 }, limits: { minBet: 10, maxBet: 10000 }, visibility: {} }
test('admin configuration and rate versions validate tenant ownership, preserve old rates, and allow an active replacement', async () => {
  const market = await createMatkaDb(config, tenant)
  await assert.rejects(updateMatkaDb({id:market.id,limits:{minBet:100,maxBet:10}},tenant), /Maximum stake/)
  const before = new Date(Date.now()-60000).toISOString(), next = new Date().toISOString()
  await createRateVersionDb({matkaId:market.id,versionTag:'v1',effectiveFrom:before,entries:[{betType:'SINGLE',payoutMultiplier:9}]},tenant)
  await createRateVersionDb({matkaId:market.id,versionTag:'v2',effectiveFrom:next,entries:[{betType:'SINGLE',payoutMultiplier:10}]},tenant)
  assert.equal((await effectiveMatkaRates(db,tenant,market.id,'worli',new Date(before)))[0].payoutMultiplier,'9')
  assert.equal((await effectiveMatkaRates(db,tenant,market.id,'worli',new Date(next)))[0].payoutMultiplier,'10')
  await assert.rejects(createRateVersionDb({matkaId:market.id,versionTag:'bad',effectiveFrom:next,entries:[{betType:'SINGLE',payoutMultiplier:0}]},tenant), /positive/)
  await assert.rejects(createRateVersionDb({matkaId:market.id,versionTag:'wrong-tenant',effectiveFrom:next,entries:[{betType:'SINGLE',payoutMultiplier:9}]},'another-tenant'), /not found/)
})
test('running sessions, books, bets, activity and subscriptions cannot cross whitelabels', async () => {
  await ensureTodayWorliInstancesForActiveMatkas(tenant)
  const [market] = await db.select().from(tables.matkas).where(eq(tables.matkas.tenant,tenant)).limit(1)
  const [instance] = await db.select().from(tables.matkaWorliInstances).where(eq(tables.matkaWorliInstances.marketId,market.id)).limit(1)
  await updateMatkaDb({id:market.id,settings:{...config.settings,betWindowMinsBeforeOpen:30}},tenant)
  const [adjusted] = await db.select().from(tables.matkaWorliInstances).where(eq(tables.matkaWorliInstances.id,instance.id))
  if(adjusted.side==='OPEN') assert.equal(adjusted.scheduledCloseAtUtc!.getTime()-adjusted.scheduledLockAtUtc!.getTime(),30*60000)
  const ctx:any = {tenant,permissions:[{domain:'matka.worli',actions:['view']}],pubsub:{subscribe:async()=>({})}}
  assert.ok((await worliQueryResolvers.worliRunningInstances(null,{},ctx)).items.every((item:any)=>item.marketId===market.id))
  assert.equal((await worliQueryResolvers.worliRunningInstances(null,{}, {...ctx,tenant:'another-tenant'})).total,0)
  for (const name of ['worliInstance','worliBook','worliBets','worliActivity'] as const) await assert.rejects((worliQueryResolvers[name] as any)(null,{id:instance.id,instanceId:instance.id},{...ctx,tenant:'another-tenant'}),/not found/)
  await assert.rejects(worliSubscriptionResolvers.worliInstanceUpdated.subscribe(null,{id:instance.id},{...ctx,tenant:'another-tenant'}),/not found/)
})
test('scheduled non-default-tenant results use the same real settlement and idempotency guards', async () => {
  const market = await createMatkaDb({...config,name:'Scheduled QA Market',code:'scheduled-'+randomUUID().slice(0,8),settings:{...config.settings,matkaType:'jackpot'}},tenant)
  const date = new Date().toISOString().slice(0,10)
  const [schedule] = await db.insert(tables.matkaResultSchedules).values({tenant,matkaId:market.id,date,type:'close',result:'05',scheduledBy:'qa',scheduledAt:new Date(Date.now()-1000),status:'pending'}).returning()
  const outcome = await processScheduledResults(null);assert.ok(outcome.some(row=>row.scheduleId===schedule.id&&row.success))
  const result = await createMatkaResult({matkaId:market.id,date,type:'close',result:'05',idempotencyKey:`scheduled:${schedule.id}`},{tenant,actorId:'qa'})
  assert.equal(result.replayed,true);assert.equal(result.result,'05')
  await rollbackMatkaResult({id:result.id,reason:'Isolated scheduled correction'},{tenant,actorId:'qa'})
})
